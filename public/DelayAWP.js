const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class DelayAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'delay ms',
        defaultValue: 0,
        minValue: 0,
        maxValue: 60 * 1000,
        automationRate: 'a-rate',
      },
      {
        name: 'delay gain',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'a-rate',
      },
      {
        name: 'feedback',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'a-rate',
      },
      {
        name: 'highpass cutoff freq',
        defaultValue: 0,
        minValue: 0,
        maxValue: 18_000,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor() {
    super();

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.mainIOBufferPointer = 0;
    this.delayOutputBufferPointer = 0;
    this.paramPointers = {
      delayMs: 0,
      delayGain: 0,
      feedback: 0,
      highpassCutoff: 0,
    };

    this.port.onmessage = evt => this.handleMessage(evt.data);
  }

  async initWasmInstance(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, { env: {} });

    this.ctxPtr = this.wasmInstance.exports.init_delay_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    this.mainIOBufferPointer = this.wasmInstance.exports.get_main_io_buffer_ptr(this.ctxPtr);
    this.delayOutputBufferPointer = this.wasmInstance.exports.get_delay_output_buffer_ptr(
      this.ctxPtr
    );
    this.paramPointers.delayMs = this.wasmInstance.exports.get_delay_ms_ptr(this.ctxPtr);
    this.paramPointers.delayGain = this.wasmInstance.exports.get_delay_gain_ptr(this.ctxPtr);
    this.paramPointers.feedback = this.wasmInstance.exports.get_feedback_ptr(this.ctxPtr);
    this.paramPointers.highpassCutoff = this.wasmInstance.exports.get_highpass_cutoff_ptr(
      this.ctxPtr
    );
  }

  handleMessage(data) {
    switch (data.type) {
      case 'setWasmBytes': {
        this.initWasmInstance(data.wasmBytes);
        break;
      }
      case 'shutdown': {
        this.isShutdown = true;
        break;
      }
      default: {
        console.error('Unhandled message type in delay AWP: ', evt.data.type);
      }
    }
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  copyParam = (param, paramPointer) => {
    if (param.length === 1) {
      this.wasmMemoryBuffer
        .subarray(paramPointer / BYTES_PER_F32, paramPointer / BYTES_PER_F32 + FRAME_SIZE)
        .fill(param[0]);
    } else {
      this.wasmMemoryBuffer.set(param, paramPointer / BYTES_PER_F32);
    }
  };

  process(inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.ctxPtr || !inputs[0]?.[0]) {
      return true;
    }

    // Copy samples into Wasm memory
    const wasmMemory = this.getWasmMemoryBuffer();
    const mainIOBuffer = wasmMemory.subarray(
      this.mainIOBufferPointer / BYTES_PER_F32,
      this.mainIOBufferPointer / BYTES_PER_F32 + FRAME_SIZE
    );
    mainIOBuffer.set(inputs[0][0]);

    // Copy params into Wasm memory
    const delayMs = params['delay ms'];
    const delayGain = params['delay gain'];
    const feedback = params['feedback'];
    const highpassCutoff = params['highpass cutoff freq'];
    this.copyParam(delayMs, this.paramPointers.delayMs);
    this.copyParam(delayGain, this.paramPointers.delayGain);
    this.copyParam(feedback, this.paramPointers.feedback);
    this.copyParam(highpassCutoff, this.paramPointers.highpassCutoff);

    // Process delay, overwriting the main IO buffer in Wasm and populating the delay output buffer
    this.wasmInstance.exports.process_delay(this.ctxPtr);

    // Copy outputs output Wasm to output array
    outputs[0]?.[0]?.set(
      wasmMemory.subarray(
        this.mainIOBufferPointer / BYTES_PER_F32,
        this.mainIOBufferPointer / BYTES_PER_F32 + FRAME_SIZE
      )
    );
    const delayOutputBuffer = wasmMemory.subarray(
      this.delayOutputBufferPointer / BYTES_PER_F32,
      this.delayOutputBufferPointer / BYTES_PER_F32 + FRAME_SIZE
    );
    outputs[1]?.[0]?.set(delayOutputBuffer);

    return true;
  }
}

registerProcessor('delay-awp', DelayAWP);
