import * as R from 'ramda';
import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import type { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import {
  buildConfigureParamSourceSettings,
  buildDefaultParamSource,
  type ParamSource,
} from 'src/fmSynth/ParamSource';
import TrainingMIDIControlIndexContext from 'src/fmSynth/TrainingMIDIControlIndexContext';
import type { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import { msToSamples, samplesToMs, UnreachableError } from 'src/util';

export const PARAM_BUFFER_COUNT = 8;

const LazyADSR2 = React.lazy(() => import('src/controls/adsr2/adsr2'));

const updateState = (state: ParamSource, newState: Partial<ParamSource>): ParamSource => ({
  ...(state as any),
  ...newState,
});

interface ADSRLengthTypePickerProps {
  value: ParamSource;
  onChange: (value: ParamSource) => void;
  theme?: { [key: string]: any };
}

const ADSRLengthTypePicker: React.FC<ADSRLengthTypePickerProps> = ({ value, onChange, theme }) => {
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

interface ADSRBeatLengthPickerProps {
  value: Extract<ParamSource, { type: 'beats to samples' }>;
  onChange: (value: ParamSource) => void;
  theme?: { [key: string]: any };
}

const ADSRBeatLengthPicker: React.FC<ADSRBeatLengthPickerProps> = ({ value, onChange, theme }) => (
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
}) => (
  <ConfigureParamSource
    title='adsr length ms'
    adsrs={EMPTY_ADSRS}
    onAdsrChange={useCallback(() => {
      throw new UnreachableError('Cannot use ADSRs when configuring `adsr_length_ms`');
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

export interface ConfigureParamSourceInnerProps extends ConfigureParamSourceProps {
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
        paramBufferCount: PARAM_BUFFER_COUNT,
      }),
    [state, excludedTypes, min, max, scale, step, adsrs, onAdsrChange, midiNode, onChange]
  );

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
            'offset hz': state.type === 'base frequency multiplier' ? state.offsetHz : undefined,
            'buffer index':
              state.type === 'param buffer' ? state['buffer index'].toString() : undefined,
            'output range':
              (adsr && state.type === 'adsr') || state.type === 'midi control'
                ? [state.shift, state.shift + state.scale]
                : undefined,
            adsr: adsr ? adsr : undefined,
            'log scale': adsr ? (adsr.logScale ?? false) : undefined,
            range: state.type === 'random' ? [state.min, state.max] : undefined,
            'update interval samples':
              state.type === 'random' ? state.updateIntervalSamples : undefined,
            'enable smoothing':
              state.type === 'random' ? state.smoothingCoefficient > 0 : undefined,
            'smoothing coefficient':
              state.type === 'random' && state.smoothingCoefficient > 0
                ? state.smoothingCoefficient
                : undefined,
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
            case 'offset hz': {
              if (window.isNaN(value)) {
                break;
              }
              onChange(updateState(state, { offsetHz: value }));
              break;
            }
            case 'enable smoothing': {
              onChange(updateState(state, { smoothingCoefficient: value ? 0.99 : 0 }));
              break;
            }
            case 'update interval samples': {
              onChange(updateState(state, { updateIntervalSamples: value }));
              break;
            }
            case 'smoothing coefficient': {
              onChange(updateState(state, { smoothingCoefficient: value }));
              break;
            }
            case 'range': {
              onChange(updateState(state, { min: value[0], max: value[1] }));
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
          <React.Suspense fallback={null}>
            <LazyADSR2
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
              debugName={`fm synth adsr ${vcId} ${state['adsr index']}`}
            />
          </React.Suspense>
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
      {({ midiNode }) => <ConfigureParamSourceInner {...props} midiNode={midiNode!} />}
    </TrainingMIDIControlIndexContext.Consumer>
  );
};

export default ConfigureParamSource;
