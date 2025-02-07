class SmoothAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();
    this.didReportInitialized = false;
    this.previousValue = 0;
    this.filterCoefficient = 0;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setState': {
          this.filterCoefficient = evt.data.state.filterCoefficient;
          if (!this.didReportInitialized) {
            this.didReportInitialized = true;
            this.port.postMessage({ type: 'initialized' });
          }
          break;
        }
        default:
          console.error('Unknown message type in SmoothAWP', evt.data.type);
      }
    };
  }

  process(inputs, outputs, _parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) {
      return true;
    }

    const filterCoefficient = this.filterCoefficient;

    let prevValue = this.previousValue;
    for (let i = 0; i < input.length; i++) {
      prevValue = prevValue * filterCoefficient + input[i] * (1 - filterCoefficient);
      output[i] = prevValue;
    }

    if (Number.isNaN(prevValue) || !isFinite(prevValue)) {
      if (!this.didReportDenormal) {
        this.didReportDenormal = true;
        console.error('Denormal in SmoothAWP');
      }
      this.previousValue = 0;
    } else {
      this.previousValue = prevValue;
    }

    return true;
  }
}

registerProcessor('smooth-awp', SmoothAWP);
