class GlobalLimiterAWP extends AudioWorkletProcessor {
  constructor() {
    super();

    this.isShutdown = false;

    this.port.onmessage = evt => this.handleMessage(evt.data);
  }

  handleMessage(data) {
    switch (data.type) {
      default: {
        console.error('Unhandled message type in global limiter AWP: ', evt.data.type);
      }
    }
  }

  process(inputs, outputs, _params) {
    if (this.isShutdown) {
      return false;
    }

    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) {
      return true;
    }

    // TODO

    return true;
  }
}

registerProcessor('global-limiter-awp', GlobalLimiterAWP);
