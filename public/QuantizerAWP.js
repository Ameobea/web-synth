const FRAME_SIZE = 128;
const BYTES_PER_F32 = 32 / 8;

class QuantizerAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'input',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor() {
    super();

    this.pendingMessages = [];

    this.port.onmessage = evt => {
      if (!this.wasmInstance && evt.data.type !== 'setWasmBytes') {
        this.pendingMessages.push(evt.data);
        return;
      }

      this.handleMessage(evt.data);
    };
  }

  handleMessage = async data => {
    switch (data.type) {
      case 'setWasmBytes': {
        await this.initWasm(data.wasmBytes);
        break;
      }
      case 'setState': {
        this.setState(data.state);
        break;
      }

      default: {
        console.warn('Unhandled message type in quantizer AWP: ', data.type);
      }
    }
  };

  setState = ({ quantizationInterval, mode }) =>
    this.wasmInstance.exports.set_quantization_state(quantizationInterval, mode);

  async initWasm(wasmBytes) {
    const importObject = { env: {} };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    this.pendingMessages.forEach(data => this.handleMessage(data));
    this.pendingMessages = [];
  }

  process(_inputs, outputs, params) {
    if (!this.wasmInstance || !outputs[0]?.[0]) {
      return true;
    }

    const ioBufPtr = this.wasmInstance.exports.get_io_buf_ptr();
    const ioBuf = this.wasmMemoryBuffer.subarray(
      ioBufPtr / BYTES_PER_F32,
      ioBufPtr / BYTES_PER_F32 + FRAME_SIZE
    );
    if (params.input.length > 1) {
      ioBuf.set(params.input);
    } else {
      ioBuf.fill(params.input[0]);
    }
    this.wasmInstance.exports.process();

    outputs.forEach(channels => channels.forEach(channel => channel.set(ioBuf)));

    return true;
  }
}

registerProcessor('quantizer', QuantizerAWP);
