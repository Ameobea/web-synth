import type { AudioThreadData } from 'src/controls/adsr2/adsr2';
import type { ConfigureParamSourceInnerProps } from 'src/fmSynth/ConfigureParamSource';
import type { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
import { MIDINode, type MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { UnimplementedError, UnreachableError, filterNils } from 'src/util';

/**
 * A parameter/value generator function.  Used to produce the frequency input values for
 * operators.
 */
export type ParamSource =
  | { type: 'param buffer'; 'buffer index': number }
  | { type: 'constant'; value: number }
  | { type: 'adsr'; 'adsr index': number; scale: number; shift: number }
  | { type: 'base frequency multiplier'; multiplier: number; offsetHz?: number }
  | {
      type: 'midi control';
      midiControlIndex: number;
      scale: number;
      shift: number;
      dstMIDINode?: undefined;
    }
  | {
      type: 'midi control';
      midiControlIndex: null;
      scale: number;
      shift: number;
      dstMIDINode?: undefined;
    }
  | {
      type: 'midi control';
      midiControlIndex: 'LEARNING';
      /**
       * If we're in this state, this node is connected as the destination to the MIDI node
       * controlling the FM synth.  We use this to intercept generic control events so we know
       * which control index to associate/learn
       */
      dstMIDINode: MIDINode;
      scale: number;
      shift: number;
    }
  | { type: 'beats to samples'; value: number }
  | {
      type: 'random';
      min: number;
      max: number;
      smoothingCoefficient: number;
      updateIntervalSamples: number;
    };

export const buildDefaultParamSource = (
  type: ParamSource['type'],
  min: number,
  max: number,
  defaultVal = min
): ParamSource => {
  switch (type) {
    case 'param buffer': {
      return { type, 'buffer index': 0 };
    }
    case 'constant': {
      return { type, value: defaultVal };
    }
    case 'adsr': {
      return { type, 'adsr index': 0, scale: max - min, shift: min };
    }
    case 'base frequency multiplier': {
      return { type, multiplier: 1 };
    }
    case 'midi control': {
      return { type, midiControlIndex: null, scale: 0, shift: 0 };
    }
    case 'random': {
      return {
        type,
        min,
        max,
        smoothingCoefficient: 0,
        updateIntervalSamples: 1,
      };
    }
    default: {
      throw new UnreachableError('Invalid operator state type: ' + type);
    }
  }
};

export interface EncodedParamSource {
  valueType: number;
  valParamInt: number;
  valParamFloat: number;
  valParamFloat2: number;
  valParamFloat3: number;
}

export const encodeParamSource = (source: ParamSource | null | undefined): EncodedParamSource => {
  if (!source) {
    return {
      valueType: -1,
      valParamInt: 0,
      valParamFloat: 0,
      valParamFloat2: 0,
      valParamFloat3: 0,
    };
  }

  switch (source.type) {
    case 'base frequency multiplier': {
      return {
        valueType: 3,
        valParamInt: 0,
        valParamFloat: source.multiplier,
        valParamFloat2: source.offsetHz ?? 0,
        valParamFloat3: 0,
      };
    }
    case 'constant': {
      return {
        valueType: 1,
        valParamInt: 0,
        valParamFloat: source.value,
        valParamFloat2: 0,
        valParamFloat3: 0,
      };
    }
    case 'adsr': {
      return {
        valueType: 2,
        valParamInt: source['adsr index'],
        valParamFloat: source.scale,
        valParamFloat2: source.shift,
        valParamFloat3: 0,
      };
    }
    case 'param buffer': {
      return {
        valueType: 0,
        valParamInt: source['buffer index'],
        valParamFloat: 0,
        valParamFloat2: 0,
        valParamFloat3: 0,
      };
    }
    case 'midi control': {
      return {
        valueType: 4,
        // TODO: Check this if we ever go back and work with MIDI control
        valParamInt: typeof source.midiControlIndex === 'number' ? source.midiControlIndex : -1,
        valParamFloat: source.scale,
        valParamFloat2: source.shift,
        valParamFloat3: 0,
      };
    }
    case 'beats to samples': {
      return {
        valueType: 5,
        valParamInt: 0,
        valParamFloat: source.value,
        valParamFloat2: 0,
        valParamFloat3: 0,
      };
    }
    case 'random': {
      return {
        valueType: 6,
        valParamInt: source.updateIntervalSamples,
        valParamFloat: source.min,
        valParamFloat2: source.max,
        valParamFloat3: source.smoothingCoefficient,
      };
    }
    default: {
      throw new UnimplementedError(`param source not yet implemented: ${(source as any).type}`);
    }
  }
};

const buildTypeSetting = (excludedTypes?: ParamSource['type'][]) => ({
  type: 'select',
  label: 'type',
  options: [
    'param buffer',
    'constant',
    'adsr',
    'base frequency multiplier',
    'midi control',
    'random',
  ].filter(paramType => !excludedTypes?.includes(paramType as any)),
});

export const buildDefaultAdsr = (audioThreadData?: AudioThreadData): AdsrParams => ({
  steps: [
    { x: 0, y: 0.8, ramper: { type: 'linear' } },
    { x: 0.3, y: 0, ramper: { type: 'exponential', exponent: 1 / 2 } }, // attack
    { x: 1, y: 0, ramper: { type: 'exponential', exponent: 1 / 2 } }, // end
  ],
  lenSamples: { type: 'constant', value: 44100 },
  loopPoint: null,
  releasePoint: 0.7,
  audioThreadData: audioThreadData ?? { phaseIndex: 0, debugName: 'buildDefaultAdsr' },
  logScale: false,
});

interface BuildConfigureParamSourceSettingsArgs
  extends Pick<
    ConfigureParamSourceInnerProps,
    | 'state'
    | 'excludedTypes'
    | 'min'
    | 'max'
    | 'scale'
    | 'step'
    | 'adsrs'
    | 'onAdsrChange'
    | 'midiNode'
    | 'onChange'
  > {
  paramBufferCount: number;
}

export const buildConfigureParamSourceSettings = ({
  state,
  excludedTypes,
  min,
  max,
  scale,
  step,
  adsrs,
  onAdsrChange,
  midiNode,
  onChange,
  paramBufferCount,
}: BuildConfigureParamSourceSettingsArgs) => {
  switch (state.type) {
    case 'param buffer': {
      return [
        buildTypeSetting(excludedTypes),
        {
          type: 'select',
          label: 'buffer index',
          options: new Array(paramBufferCount).fill(0).map((_i, i) => i),
        },
      ];
    }
    case 'constant': {
      return [
        buildTypeSetting(excludedTypes),
        { type: 'range', label: 'value', min, max, scale, step },
      ];
    }
    case 'adsr': {
      return [
        buildTypeSetting(excludedTypes),
        {
          type: 'select',
          label: 'adsr index',
          options: new Array(adsrs.length).fill(0).map((_i, i) => i),
        },
        {
          type: 'checkbox',
          label: 'log scale',
        },
        {
          type: 'button',
          label: 'add envelope generator',
          action: () => {
            onAdsrChange(
              adsrs.length,
              buildDefaultAdsr({
                ...adsrs[0].audioThreadData,
                phaseIndex: adsrs.length,
                debugName: 'buildConfigureParamSourceSettings -> buildDefaultAdsr',
              })
            );
          },
        },
        {
          label: 'output range',
          type: 'interval',
          steps: 1000,
          min,
          max,
        },
      ];
    }
    case 'base frequency multiplier': {
      return [
        buildTypeSetting(excludedTypes),
        {
          type: 'range',
          label: 'multiplier',
          min: 0,
          max: 16,
          step: 0.125,
        },
        {
          type: 'range',
          label: 'offset hz',
          min: -100,
          max: 100,
          step: 0.1,
        },
      ];
    }
    case 'midi control': {
      return [
        buildTypeSetting(excludedTypes),
        {
          type: 'button',
          label: state.midiControlIndex === 'LEARNING' ? 'cancel learning' : 'learn midi',
          action: () => {
            if (state.midiControlIndex === 'LEARNING') {
              midiNode.disconnect(state.dstMIDINode);
              onChange({ ...state, midiControlIndex: null, dstMIDINode: undefined });
            } else {
              const cbs: MIDIInputCbs = {
                onAttack: () => {
                  /* ignore */
                },
                onRelease: () => {
                  /* ignore */
                },
                onPitchBend: () => {
                  /* ignore */
                },
                onClearAll: () => {
                  /* ignore */
                },
                onGenericControl: (controlIndex, _controlValue) => {
                  console.log('Assigning MIDI control index: ', controlIndex);

                  onChange({
                    ...state,
                    midiControlIndex: controlIndex,
                    dstMIDINode: undefined,
                  });
                  midiNode.disconnect(dstMIDINode);
                },
              };
              const dstMIDINode = new MIDINode(() => cbs);
              midiNode.connect(dstMIDINode);
              onChange({
                ...state,
                midiControlIndex: 'LEARNING' as const,
                dstMIDINode,
              });
            }
          },
        },
        {
          label: 'output range',
          type: 'interval',
          min,
          max,
        },
      ];
    }
    case 'random': {
      return filterNils([
        buildTypeSetting(excludedTypes),
        {
          type: 'interval',
          label: 'range',
          min,
          max,
        },
        {
          type: 'range',
          label: 'update interval samples',
          min: 1,
          max: 44_100 / 2,
          step: 1,
        },
        {
          type: 'checkbox',
          label: 'enable smoothing',
        },
        state.smoothingCoefficient > 0
          ? {
              type: 'range',
              label: 'smoothing coefficient',
              min: 0.9,
              max: 0.9999,
              scale: 'log',
            }
          : null,
      ]);
    }
    default: {
      console.error('Invalid operator state type: ', (state as any).type);
    }
  }
};
