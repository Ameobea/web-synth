import { UnreachableException } from 'ameo-utils';
import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';

import ADSR2, { AudioThreadData } from 'src/controls/adsr2/adsr2';
import type { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import TrainingMIDIControlIndexContext from 'src/fmSynth/TrainingMIDIControlIndexContext';
import { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import MIDIControlValuesCache from 'src/graphEditor/nodes/CustomAudio/FMSynth/MIDIControlValuesCache';
import { MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';
import { msToSamples, samplesToMs } from 'src/util';

export const PARAM_BUFFER_COUNT = 8;

/**
 * A parameter/value generator function.  Used to produce the frequency input values for
 * operators.
 */
export type ParamSource =
  | { type: 'param buffer'; 'buffer index': number }
  | { type: 'constant'; value: number }
  | { type: 'adsr'; 'adsr index': number; scale: number; shift: number }
  | { type: 'base frequency multiplier'; multiplier: number }
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
  | { type: 'beats to samples'; value: number };

const buildTypeSetting = (excludedTypes?: ParamSource['type'][]) => ({
  type: 'select',
  label: 'type',
  options: ['param buffer', 'constant', 'adsr', 'base frequency multiplier', 'midi control'].filter(
    paramType => !excludedTypes?.includes(paramType as any)
  ),
});

const updateState = (state: ParamSource, newState: Partial<ParamSource>): ParamSource => ({
  ...(state as any),
  ...newState,
});

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
    default: {
      throw new UnreachableException('Invalid operator state type: ' + type);
    }
  }
};

export const buildDefaultAdsr = (audioThreadData?: AudioThreadData): AdsrParams => ({
  steps: [
    { x: 0, y: 0, ramper: { type: 'linear' } }, // start
    { x: 0.05, y: 0.865, ramper: { type: 'exponential', exponent: 1 / 2 } }, // attack
    { x: 0.12, y: 0.8, ramper: { type: 'exponential', exponent: 1 / 2 } }, // decay
    { x: 0.93, y: 0.8, ramper: { type: 'exponential', exponent: 1 / 2 } }, // release
    { x: 1, y: 0, ramper: { type: 'exponential', exponent: 1 / 2 } }, // end
  ],
  lenSamples: { type: 'constant', value: 44100 },
  loopPoint: null,
  releasePoint: 0.7,
  audioThreadData: audioThreadData ?? { phaseIndex: 0 },
  logScale: false,
});

const ADSRLengthTypePicker: React.FC<{
  value: ParamSource;
  onChange: (value: ParamSource) => void;
  theme?: { [key: string]: any };
}> = ({ value, onChange, theme }) => {
  const state = useMemo(
    () => ({ 'length type': value.type === 'beats to samples' ? [false, true] : [true, false] }),
    [value.type]
  );

  return (
    <ControlPanel
      width={500}
      theme={theme}
      state={useMemo(() => R.clone(state), [state])}
      settings={useMemo(
        () => [{ type: 'multibox', label: 'length type', names: ['milliseconds', 'beats'] }],
        []
      )}
      onChange={useCallback(
        (_key: string, val: [boolean, boolean], _state: any) => {
          const millisecondsToggled = state['length type'][0] !== val[0];
          const beatsToggled = state['length type'][1] !== val[1];

          if (!millisecondsToggled && !beatsToggled) {
            return;
          }

          const nowIsMilliseconds = millisecondsToggled ? val[0] : !val[1];

          if (nowIsMilliseconds) {
            onChange({ type: 'constant', value: 1000 });
          } else {
            onChange({ type: 'beats to samples', value: 1 });
          }
        },
        [onChange, state]
      )}
    />
  );
};

const ADSRBeatLengthPicker: React.FC<{
  value: Extract<ParamSource, { type: 'beats to samples' }>;
  onChange: (value: ParamSource) => void;
  theme?: { [key: string]: any };
}> = ({ value, onChange, theme }) => (
  <ControlPanel
    width={500}
    theme={theme}
    settings={useMemo(() => [{ type: 'range', label: 'beats', min: 0, max: 16, step: 1 / 4 }], [])}
    state={useMemo(() => ({ beats: value.value }), [value.value])}
    onChange={useCallback(
      (_key: string, value: number, _state: any) => {
        onChange({ type: 'beats to samples', value });
      },
      [onChange]
    )}
  />
);

const ADSR_LEN_EXCLUDED_TYPES: ParamSource['type'][] = ['adsr', 'base frequency multiplier'];
const EMPTY_ADSRS: AdsrParams[] = [];

interface ConfigureADSRLengthMSProps {
  adsr: AdsrParams;
  adsrIx: number;
  onAdsrChange: AdsrChangeHandler;
  theme?: { [key: string]: any };
  vcId: string | undefined;
}

const ConfigureADSRLengthMS: React.FC<ConfigureADSRLengthMSProps> = ({
  adsr,
  adsrIx,
  theme,
  onAdsrChange,
  vcId,
}) => {
  return (
    <ConfigureParamSource
      title='adsr length ms'
      adsrs={EMPTY_ADSRS}
      onAdsrChange={useCallback(() => {
        throw new UnreachableException('Cannot use ADSRs when configuring `adsr_length_ms`');
      }, [])}
      state={useMemo(
        () =>
          adsr.lenSamples.type === 'constant'
            ? { type: 'constant', value: samplesToMs(adsr.lenSamples.value) }
            : adsr.lenSamples,
        [adsr.lenSamples]
      )}
      min={1}
      max={20_000}
      scale='log'
      onChange={useCallback(
        newLenMs => {
          const lenSamples =
            newLenMs.type === 'constant'
              ? { type: 'constant' as const, value: msToSamples(newLenMs.value) }
              : newLenMs;
          onAdsrChange(adsrIx, { ...adsr, lenSamples });
        },
        [adsr, adsrIx, onAdsrChange]
      )}
      excludedTypes={ADSR_LEN_EXCLUDED_TYPES}
      theme={theme}
      vcId={vcId}
    />
  );
};

type BuildConfigureParamSourceSettingsArgs = Pick<
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
>;

const buildConfigureParamSourceSettings = ({
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
}: BuildConfigureParamSourceSettingsArgs) => {
  switch (state.type) {
    case 'param buffer': {
      return [
        buildTypeSetting(excludedTypes),
        {
          type: 'select',
          label: 'buffer index',
          options: new Array(PARAM_BUFFER_COUNT).fill(0).map((_i, i) => i),
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
          label: 'add adsr',
          action: () => {
            onAdsrChange(
              adsrs.length,
              buildDefaultAdsr({ ...adsrs[0].audioThreadData, phaseIndex: adsrs.length })
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
    default: {
      console.error('Invalid operator state type: ', (state as any).type);
    }
  }
};

interface ConfigureParamSourceProps {
  title?: React.ReactNode;
  theme?: { [key: string]: any };
  state: ParamSource;
  onChange: (newState: ParamSource) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  min?: number;
  max?: number;
  step?: number;
  defaultVal?: number;
  scale?: 'log';
  excludedTypes?: ParamSource['type'][];
  vcId: string | undefined;
}

interface ConfigureParamSourceInnerProps extends ConfigureParamSourceProps {
  midiNode: MIDINode;
}

const ConfigureParamSourceInnerInner: React.FC<ConfigureParamSourceInnerProps> = ({
  title,
  adsrs,
  onAdsrChange,
  theme,
  state,
  onChange,
  min = 0,
  max = 1,
  step,
  defaultVal,
  scale,
  excludedTypes,
  midiNode,
  vcId,
}) => {
  const settings = useMemo(
    () =>
      buildConfigureParamSourceSettings({
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
      }),
    [state, excludedTypes, min, max, scale, step, adsrs, onAdsrChange, midiNode, onChange]
  );

  if (!vcId) {
    console.trace({ vcId });
  }
  const adsr = state.type === 'adsr' ? adsrs[state['adsr index']] : undefined;

  return (
    <>
      <ControlPanel
        title={title}
        theme={theme}
        width={500}
        settings={settings}
        state={useMemo(
          () => ({
            ...state,
            'buffer index':
              state.type === 'param buffer' ? state['buffer index'].toString() : undefined,
            'output range':
              (adsr && state.type === 'adsr') || state.type === 'midi control'
                ? [state.shift, state.shift + state.scale]
                : undefined,
            adsr: adsr ? adsr : undefined,
            'log scale': adsr ? adsr.logScale ?? false : undefined,
          }),
          [adsr, state]
        )}
        onChange={(key: string, value: any) => {
          switch (key) {
            case 'type': {
              if (state.type === value) {
                return;
              }

              onChange(updateState(state, buildDefaultParamSource(value, min, max, defaultVal)));
              break;
            }
            case 'buffer index': {
              onChange(updateState(state, { 'buffer index': +value }));
              break;
            }
            case 'value': {
              if (window.isNaN(value)) {
                break;
              }
              onChange(updateState(state, { value }));
              break;
            }
            case 'adsr index': {
              onChange(updateState(state, { 'adsr index': +value }));
              break;
            }
            case 'output range': {
              const [clampedMin, clampedMax]: [number, number] = value;
              const scale = clampedMax - clampedMin;
              const shift = clampedMin;
              onChange(updateState(state, { scale, shift }));
              break;
            }
            case 'log scale': {
              const adsrIx = (state as Extract<typeof state, { type: 'adsr' }>)['adsr index'];
              onAdsrChange(adsrIx, { ...adsrs[adsrIx], logScale: value ?? false });
              break;
            }
            case 'multiplier': {
              if (window.isNaN(value)) {
                break;
              }
              onChange(updateState(state, { multiplier: value }));
              break;
            }
            default: {
              console.error('Unhandled param value configurator key: ', key);
            }
          }
        }}
      />
      {state.type === 'adsr' && adsr ? (
        <>
          <ADSRLengthTypePicker
            value={adsr.lenSamples}
            onChange={newLenSamples => {
              const adsrIx = (state as Extract<typeof state, { type: 'adsr' }>)['adsr index'];
              console.log({ newLenSamples });
              onAdsrChange(adsrIx, {
                ...adsrs[adsrIx],
                lenSamples: newLenSamples,
              });
            }}
            theme={theme}
          />
          {adsr.lenSamples.type === 'beats to samples' ? (
            <ADSRBeatLengthPicker
              value={adsr.lenSamples}
              onChange={newLenSamples => {
                const adsrIx = (state as Extract<typeof state, { type: 'adsr' }>)['adsr index'];
                onAdsrChange(adsrIx, {
                  ...adsrs[adsrIx],
                  lenSamples: newLenSamples,
                });
              }}
              theme={theme}
            />
          ) : (
            <ConfigureADSRLengthMS
              adsr={adsr}
              adsrIx={(state as Extract<typeof state, { type: 'adsr' }>)['adsr index']}
              onAdsrChange={onAdsrChange}
              vcId={vcId}
            />
          )}
          <ADSR2
            width={490}
            height={320}
            initialState={{
              ...adsrs[state['adsr index']],
              lenSamples:
                adsrs[state['adsr index']].lenSamples.type === 'constant'
                  ? (adsrs[state['adsr index']].lenSamples as any).value
                  : 1000,
              outputRange: [state.shift, state.shift + state.scale],
            }}
            onChange={newAdsr => {
              const adsrIx = (state as Extract<typeof state, { type: 'adsr' }>)['adsr index'];
              onAdsrChange(adsrIx, {
                ...newAdsr,
                lenSamples: adsrs[state['adsr index']].lenSamples,
              });
            }}
            vcId={vcId}
          />
        </>
      ) : null}
    </>
  );
};

const ConfigureParamSourceInner = React.memo(ConfigureParamSourceInnerInner);

const ConfigureParamSource: React.FC<ConfigureParamSourceProps> = props => {
  if (props.state.type !== 'midi control') {
    return <ConfigureParamSourceInner {...props} midiNode={null as any} />;
  }

  return (
    <TrainingMIDIControlIndexContext.Consumer>
      {({ midiNode }) => <ConfigureParamSourceInner {...props} midiNode={midiNode} />}
    </TrainingMIDIControlIndexContext.Consumer>
  );
};

export default ConfigureParamSource;
