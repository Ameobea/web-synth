class RisingEdgeDetectorWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'input',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
    ];
  }

  isGated = false;

  sendMarkMessage() {
    this.port.postMessage(undefined);
  }

  process(_inputs, _outputs, params) {
    for (let i = 0; i < params.input.length; i++) {
      if (!!params.input[i] !== this.isGated) {
        this.isGated = !this.isGated;
        if (this.isGated) {
          this.sendMarkMessage();
        }
      }
    }

    return false;
  }
}

registerProcessor(
  'rising-edge-detector-audio-worklet-node-processor',
  RisingEdgeDetectorWorkletProcessor
);
