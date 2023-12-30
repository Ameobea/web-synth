const PARAM_DESCRIPTORS = [];

class SamplerAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAM_DESCRIPTORS;
  }

  constructor() {
    super();

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.wasmInstance = null;
    this.wasmMemoryBuffer = null;
    this.pendingMessages = [];

    this.port.onmessage = evt => this.handleMessage(evt.data);
  }

  async initWasmInstance(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, { env: {} });

    this.ctxPtr = this.wasmInstance.exports.init_sampler_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);

    this.pendingMessages.forEach(data => this.handleMessage(data));
    this.pendingMessages = [];
  }

  handleMessage(data) {
    // Store all events other than the initialization event until after Wasm is loaded and they can be handled.
    //
    // Pending events will be processed once that initialization is finished.
    if (!this.ctxPtr && data.type !== 'setWasmBytes') {
      this.pendingMessages.push(data);
      return;
    }

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
        console.error('Unhandled message type in sampler player AWP: ', data.type);
      }
    }
  }

  process(_inputs, _outputs, _params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.ctxPtr) {
      return true;
    }

    // TODO

    return true;
  }
}

registerProcessor('sampler-awp', SamplerAWP);
