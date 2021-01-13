import { UnreachableException } from 'ameo-utils';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import ADSR2, { SerializedADSR2State } from 'src/controls/adsr2/adsr2';

import type { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

export const PARAM_BUFFER_COUNT = 8;
const SAMPLE_RATE = 44_100;

/**
 * A parameter/value generator function.  Used to produce the frequency input values for
 * operators.
 */
export type ParamSource =
  | { type: 'param buffer'; 'buffer index': number }
  | { type: 'constant'; value: number }
  | { type: 'adsr'; 'adsr index': number; scale: number; shift: number }
  | { type: 'base frequency multiplier'; multiplier: number };

const buildTypeSetting = (excludedTypes?: ParamSource['type'][]) => ({
  type: 'select',
  label: 'type',
  options: ['param buffer', 'constant', 'adsr', 'base frequency multiplier'].filter(
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
    default: {
      throw new UnreachableException('Invalid operator state type: ' + type);
    }
  }
};

const encodeAdsr = ({
  steps,
  lenSamples,
  loopPoint,
  releasePoint,
}: Adsr): SerializedADSR2State => ({
  steps,
  lengthMs: (lenSamples / SAMPLE_RATE) * 1000,
  loopPoint,
  releasePoint,
});

const decodeAdsr = (prevState: Adsr, newState: SerializedADSR2State): Adsr => ({
  steps: [...newState.steps],
  releasePoint: newState.releasePoint,
  lenSamples: (newState.lengthMs / 1000) * SAMPLE_RATE,
  loopPoint: newState.loopPoint,
  audioThreadData: prevState.audioThreadData,
});

export const buildDefaultAdsr = (): Adsr => ({
  steps: [
    { x: 0, y: 0, ramper: { type: 'linear' } }, // start
    { x: 0.05, y: 0.865, ramper: { type: 'exponential', exponent: 1 / 2 } }, // attack
    { x: 0.12, y: 0.8, ramper: { type: 'exponential', exponent: 1 / 2 } }, // decay
    { x: 0.93, y: 0.8, ramper: { type: 'exponential', exponent: 1 / 2 } }, // release
    { x: 1, y: 0, ramper: { type: 'exponential', exponent: 1 / 2 } }, // end
  ],
  lenSamples: 44100,
  loopPoint: null,
  releasePoint: 0.7,
  audioThreadData: { phaseIndex: 0 },
});

interface ConfigureParamSourceProps {
  title?: string;
  theme?: { [key: string]: any };
  state: ParamSource;
  onChange: (newState: ParamSource) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
  min?: number;
  max?: number;
  step?: number;
  defaultVal?: number;
  scale?: 'log';
  excludedTypes?: ParamSource['type'][];
}

const ConfigureParamSource: React.FC<ConfigureParamSourceProps> = ({
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
}) => {
  const { type: paramType } = state;
  const settings = useMemo(() => {
    switch (paramType) {
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
            type: 'range',
            label: 'adsr length ms',
            min: 10,
            max: 20_000,
            scale: 'log',
          },
          {
            type: 'button',
            label: 'add adsr',
            action: () => {
              onAdsrChange(adsrs.length, buildDefaultAdsr());
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
      default: {
        console.error('Invalid operator state type: ', paramType);
      }
    }
  }, [paramType, excludedTypes, min, max, scale, step, adsrs.length, onAdsrChange]);

  return (
    <>
      <ControlPanel
        title={title}
        theme={theme}
        style={{ width: 376 }}
        settings={settings}
        state={{
          ...state,
          'buffer index':
            state.type === 'param buffer' ? state['buffer index'].toString() : undefined,
          'output range':
            state.type === 'adsr' ? [state.shift, state.shift + state.scale] : undefined,
          adsr: state.type === 'adsr' ? encodeAdsr(adsrs[state['adsr index']]) : undefined,
          'adsr length ms':
            state.type === 'adsr'
              ? (adsrs[state['adsr index']].lenSamples / 44_100) * 1000
              : undefined,
        }}
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
            case 'adsr length ms': {
              const adsrIx = (state as Extract<typeof state, { type: 'adsr' }>)['adsr index'];
              onAdsrChange(adsrIx, { ...adsrs[adsrIx], lenSamples: (value / 1000) * SAMPLE_RATE });
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
      {state.type === 'adsr' ? (
        <ADSR2
          width={376}
          height={222}
          initialState={encodeAdsr(adsrs[state['adsr index']])}
          onChange={value => {
            const adsrIx = (state as Extract<typeof state, { type: 'adsr' }>)['adsr index'];
            const decoded = decodeAdsr(adsrs[adsrIx], value);
            onAdsrChange(adsrIx, decoded);
          }}
          audioThreadData={adsrs[state['adsr index']].audioThreadData}
        />
      ) : null}
    </>
  );
};

export default ConfigureParamSource;
