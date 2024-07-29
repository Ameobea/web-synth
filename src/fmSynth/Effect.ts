import {
  encodeParamSource,
  type EncodedParamSource,
  type ParamSource,
} from 'src/fmSynth/ParamSource';
import { UnimplementedError } from 'src/util';

export enum ButterworthFilterMode {
  Lowpass = 0,
  Highpass = 1,
  Bandpass = 2,
}

export enum SoftClipperAlgorithm {
  CubicNonlinearity = 0,
  Tanh = 1,
  XOverOnePlusAbsX = 2,
  HardClipper = 3,
}

export type EffectInner =
  | {
      type: 'spectral warping';
      frequency: ParamSource;
      warpFactor: ParamSource;
      phaseOffset: number;
    }
  | {
      type: 'wavecruncher';
      topFoldPosition: ParamSource;
      topFoldWidth: ParamSource;
      bottomFoldPosition: ParamSource;
      bottomFoldWidth: ParamSource;
    }
  | { type: 'bitcrusher'; sampleRate: ParamSource; bitDepth: ParamSource; mix?: ParamSource }
  | { type: 'wavefolder'; gain: ParamSource; offset: ParamSource; mix?: ParamSource }
  | {
      type: 'soft clipper';
      preGain: ParamSource;
      postGain: ParamSource;
      mix?: ParamSource;
      algorithm: SoftClipperAlgorithm;
    }
  | { type: 'butterworth filter'; mode: ButterworthFilterMode; cutoffFrequency: ParamSource }
  | {
      type: 'delay';
      delaySamples: ParamSource;
      wet: ParamSource;
      dry: ParamSource;
      feedback: ParamSource;
    }
  | {
      type: 'moog filter';
      cutoffFrequency: ParamSource;
      resonance: ParamSource;
      drive: ParamSource;
    }
  | {
      type: 'comb filter';
      delaySamples: ParamSource;
      feedbackDelaySamples: ParamSource;
      feedbackGain: ParamSource;
      feedforwardGain: ParamSource;
    }
  | {
      type: 'compressor';
      // TODO: Params
    }
  | {
      type: 'chorus';
      modulationDepth: ParamSource;
      wet: ParamSource;
      dry: ParamSource;
      lfoRate: ParamSource;
    };

export type Effect = EffectInner & {
  isBypassed?: boolean;
  isCollapsed?: boolean;
};

type EncodedEffect = [
  number,
  EncodedParamSource | null,
  EncodedParamSource | null,
  EncodedParamSource | null,
  EncodedParamSource | null,
];

export const encodeEffect = (effect: Effect | null): EncodedEffect => {
  if (!effect) {
    return [-1, null, null, null, null];
  }

  switch (effect.type) {
    case 'spectral warping': {
      return [
        0,
        encodeParamSource(effect.frequency),
        encodeParamSource(effect.warpFactor),
        null,
        null,
      ];
    }
    case 'wavecruncher': {
      return [
        1,
        encodeParamSource(effect.topFoldPosition),
        encodeParamSource(effect.topFoldWidth),
        encodeParamSource(effect.bottomFoldPosition),
        encodeParamSource(effect.bottomFoldWidth),
      ];
    }
    case 'bitcrusher': {
      return [
        2,
        encodeParamSource(effect.sampleRate),
        encodeParamSource(effect.bitDepth),
        encodeParamSource(effect.mix ?? { type: 'constant', value: 1 }),
        null,
      ];
    }
    case 'wavefolder': {
      return [
        3,
        encodeParamSource(effect.gain),
        encodeParamSource(effect.offset),
        encodeParamSource(effect.mix ?? { type: 'constant', value: 1 }),
        null,
      ];
    }
    case 'soft clipper': {
      return [
        4,
        encodeParamSource(effect.preGain),
        encodeParamSource(effect.postGain),
        encodeParamSource(effect.mix ?? { type: 'constant', value: 1 }),
        {
          valueType: -1,
          valParamInt: effect.algorithm,
          valParamFloat: 0,
          valParamFloat2: 0,
          valParamFloat3: 0,
        },
      ];
    }
    case 'butterworth filter': {
      return [
        5,
        {
          valueType: -1,
          valParamInt: effect.mode,
          valParamFloat: 0,
          valParamFloat2: 0,
          valParamFloat3: 0,
        },
        encodeParamSource(effect.cutoffFrequency),
        null,
        null,
      ];
    }
    case 'delay': {
      return [
        6,
        encodeParamSource(effect.delaySamples),
        encodeParamSource(effect.wet),
        encodeParamSource(effect.dry),
        encodeParamSource(effect.feedback),
      ];
    }
    case 'moog filter': {
      return [
        7,
        encodeParamSource(effect.cutoffFrequency),
        encodeParamSource(effect.resonance),
        encodeParamSource(effect.drive),
        null,
      ];
    }
    case 'comb filter': {
      return [
        8,
        encodeParamSource(effect.delaySamples),
        encodeParamSource(effect.feedbackDelaySamples),
        encodeParamSource(effect.feedbackGain),
        encodeParamSource(effect.feedforwardGain),
      ];
    }
    case 'compressor': {
      return [9, null, null, null, null];
    }
    case 'chorus': {
      return [
        10,
        encodeParamSource(effect.modulationDepth),
        encodeParamSource(effect.wet),
        encodeParamSource(effect.dry),
        encodeParamSource(effect.lfoRate),
      ];
    }
    default: {
      throw new UnimplementedError(`Effect not handled yet: ${(effect as any).type}`);
    }
  }
};
