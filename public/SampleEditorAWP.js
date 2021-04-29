class SampleEditorAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();

    this.wasmInst = null;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'init' : {
          this.initWasm(evt.data.wasmBytes);
          break;
        }
        default: {
          console.warn('Unhandled event type received over port: ' + evt.data.type);
        }
      }
    };
  }

  initWasm(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInst = new WebAssembly.Instance(compiledModule, importObject);
  }

  process(_inputs, _outputs, _params) {
    if (!this.wasmInst) {
      return true;
    }

    // TODO

    return true;
  }
}

registerProcessor('sample-editor-awp', SampleEditorAWP);
