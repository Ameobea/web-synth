class ValueRecorderWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'input',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
    ];
  }

  lastValue = null;

  recordValue(value) {
    this.port.postMessage(value);
  }

  process(_inputs, _outputs, params) {
    if (params.input.length === 0) {
      return false;
    }

    const sampleCount = params.input.length;
    const value = params.input[sampleCount - 1];
    if (value !== this.lastValue) {
      this.lastValue = value;
      this.recordValue(value);
    }

    return false;
  }
}

registerProcessor('value-recorder-audio-worklet-node-processor', ValueRecorderWorkletProcessor);
