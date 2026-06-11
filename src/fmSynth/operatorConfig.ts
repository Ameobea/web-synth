import { buildDefaultParamSource, type ParamSource } from 'src/fmSynth/ParamSource';
import type { WavetablePreset } from 'src/api';
import { UnreachableError, base64ArrayBuffer, base64ToArrayBuffer } from 'src/util';

interface UnisonPhaseRandomizationConfig {
  enabled: boolean;
}

/**
 * The algorithm used to produce the output for the operator.
 */
export type OperatorConfig =
  | {
      type: 'wavetable';
      wavetableName: string | null;
      frequency: ParamSource;
      dim0IntraMix: ParamSource;
      dim1IntraMix: ParamSource;
      interDimMix: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | {
      type: 'sine oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | {
      type: 'exponential oscillator';
      frequency: ParamSource;
      stretchFactor: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | { type: 'param buffer'; bufferIx: number }
  | {
      type: 'square oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
      dutyCycle?: ParamSource;
    }
  | {
      type: 'triangle oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | {
      type: 'sawtooth oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | { type: 'sample mapping' }
  | { type: 'tuned sample' }
  | { type: 'white noise' };

export const buildDefaultOperatorConfig = (
  type: OperatorConfig['type'] = 'sine oscillator'
): OperatorConfig => {
  switch (type) {
    case 'sine oscillator':
    case 'square oscillator':
    case 'triangle oscillator':
    case 'sawtooth oscillator': {
      return {
        type,
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
        unison: 1,
        unisonDetune: buildDefaultParamSource('constant', 0, 300, 1),
        unisonPhaseRandomization: { enabled: false },
      };
    }
    case 'exponential oscillator': {
      return {
        type,
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
        stretchFactor: { type: 'constant', value: 0.5 },
        unisonPhaseRandomization: { enabled: false },
      };
    }
    case 'param buffer': {
      return { type, bufferIx: 0 };
    }
    case 'wavetable': {
      return {
        type,
        wavetableName: null,
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
        dim0IntraMix: buildDefaultParamSource('constant', 0, 1, 0.5),
        dim1IntraMix: buildDefaultParamSource('constant', 0, 1, 0.5),
        interDimMix: buildDefaultParamSource('constant', 0, 1, 0.5),
        unison: 1,
        unisonDetune: buildDefaultParamSource('constant', 0, 300, 1),
        unisonPhaseRandomization: { enabled: false },
      };
    }
    case 'sample mapping': {
      return { type };
    }
    case 'white noise': {
      return { type };
    }
    default: {
      throw new UnreachableError('Unhandled type in `buildDefaultOperatorConfig`: ' + type);
    }
  }
};

export interface WavetableBank {
  name: string;
  samples: Float32Array;
  samplesPerWaveform: number;
  waveformsPerDimension: number;
  baseFrequency: number;
  preset?: WavetablePreset;
}

export interface WavetableState {
  wavetableBanks: readonly WavetableBank[];
}

export const serializeWavetableState = (state: WavetableState) => {
  return {
    wavetableBanks: state.wavetableBanks.map(bank => ({
      ...bank,
      samples: base64ArrayBuffer(bank.samples.buffer),
    })),
  };
};

export const deserializeWavetableState = (
  serialized: ReturnType<typeof serializeWavetableState>
): WavetableState => {
  return {
    wavetableBanks: serialized.wavetableBanks.map(bank => ({
      ...bank,
      samples: new Float32Array(base64ToArrayBuffer(bank.samples)),
    })),
  };
};
