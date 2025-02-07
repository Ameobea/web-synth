class DetuneAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'detune_cents',
        defaultValue: 0,
        minValue: -1200,
        maxValue: 1200,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor() {
    super();
    this.lastDetune = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) {
      return true;
    }

    const detuneCents = parameters.detune_cents;

    let lastDetune = this.lastDetune;
    for (let i = 0; i < input.length; i++) {
      const curDetune = detuneCents.length > 1 ? detuneCents[i] : detuneCents[0];
      // slight smoothing on the detune to avoid clicks
      lastDetune = lastDetune * 0.9 + curDetune * 0.1;
      const detune = lastDetune;
      const detuneFactor = Math.pow(2, detune / 1200);
      output[i] = input[i] * detuneFactor;
    }
    this.lastDetune = lastDetune;

    return true;
  }
}

registerProcessor('detune-awp', DetuneAWP);
