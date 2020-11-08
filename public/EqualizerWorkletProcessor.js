const KNOB_COUNT = 8;
const LEVEL_COUNT = 12;
/**
 * Defines the y level percentage at which the equalizer will be +0.
 */
const ZERO_LEVEL = 0.6;

const valueToDb = value => value * 70 - ZERO_LEVEL * 70;

class EqualizerWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const descriptors = [
      {
        name: 'input',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
    ];

    for (let i = 0; i < KNOB_COUNT; i++) {
      if (i !== 0 && i !== KNOB_COUNT - 1) {
        descriptors.push({
          name: `knob_${i}_x`,
          defaultValue: -1,
          automationRate: 'k-rate',
        });
      }
      descriptors.push({
        name: `knob_${i}_y`,
        defaultValue: -1,
        automationRate: 'k-rate',
      });
    }

    return descriptors;
  }

  levels = new Array(LEVEL_COUNT).fill(0);

  computeLevels(params) {
    let curStartIx = 0;

    for (let i = 0; i < LEVEL_COUNT; i++) {
      let endX = params[`knob_${curStartIx + 1}_x`]?.[0] ?? 1;
      // if (endX === -1) {
      //   break;
      // }

      const levelPos = (i + 1) / LEVEL_COUNT;
      if (levelPos > endX) {
        curStartIx += 1;
        endX = params[`knob_${curStartIx + 1}_x`]?.[0] ?? 1;
        // if (endX === -1) {
        //   break;
        // }
      }

      // Compute the slope of the line between the start point and the end point
      const startX = params[`knob_${curStartIx}_x`]?.[0] ?? 0;
      const startY = params[`knob_${curStartIx}_y`][0];
      const slope = (params[`knob_${curStartIx + 1}_y`][0] - startY) / (endX - startX);
      const intercept = startY - slope * startX;
      const level = slope * levelPos + intercept;
      this.levels[i] = valueToDb(level);
    }
  }

  process(_inputs, _outputs, params) {
    this.computeLevels(params);
  }
}

registerProcessor('equalizer-audio-worklet-node-processor', EqualizerWorkletProcessor);
