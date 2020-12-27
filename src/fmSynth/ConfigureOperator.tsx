import { UnreachableException } from 'ameo-utils';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

/**
 * A parameter/value generator function.  Used to produce the frequency input values for
 * operators.
 */
export type ParamSource =
  | { type: 'param buffer'; bufferIx: number }
  | { type: 'constant'; value: number }
  | { type: 'adsr'; adsrIx: number }
  | { type: 'base frequency multiplier'; multiplier: number };

export interface SpectralWarpingConfig {
  frequency: ParamSource;
  warpFactor: ParamSource;
  phaseOffset: number;
}

/**
 * The algorithm used to produce the output for the operator.
 */
export type OperatorConfig = (
  | { type: 'wavetable'; wavetableIx: number }
  | { type: 'sine oscillator'; frequency: ParamSource }
  | { type: 'exponential oscillator'; frequency: ParamSource; stretchFactor: ParamSource }
  | { type: 'param buffer'; bufferIx: number }
) & { spectralWarping: SpectralWarpingConfig | null };

const buildDefaultSpectralWarpingConfig = (): SpectralWarpingConfig => ({
  frequency: { type: 'base frequency multiplier', multiplier: 1 },
  warpFactor: { type: 'constant', value: 0.7 },
  phaseOffset: 0,
});

export const buildDefaultOperatorFrequencySourceConfig = (
  type: ParamSource['type']
): ParamSource => {
  switch (type) {
    case 'param buffer': {
      return { type, bufferIx: 0 };
    }
    case 'constant': {
      return { type, value: 0 };
    }
    case 'adsr': {
      return { type, adsrIx: 0 };
    }
    case 'base frequency multiplier': {
      return { type, multiplier: 1 };
    }
    default: {
      throw new UnreachableException('Invalid operator state type: ' + type);
    }
  }
};

export const buildDefaultOperatorConfig = (
  type: OperatorConfig['type'] = 'sine oscillator'
): OperatorConfig => {
  switch (type) {
    case 'sine oscillator': {
      return {
        type,
        frequency: buildDefaultOperatorFrequencySourceConfig('base frequency multiplier'),
        spectralWarping: null,
      };
    }
    case 'exponential oscillator': {
      return {
        type,
        frequency: buildDefaultOperatorFrequencySourceConfig('base frequency multiplier'),
        stretchFactor: { type: 'constant', value: 0.5 },
        spectralWarping: null,
      };
    }
    case 'param buffer': {
      return { type, bufferIx: 0, spectralWarping: null };
    }
    default: {
      throw new UnreachableException('Unhandled type in `buildDefaultOperatorConfig`: ' + type);
    }
  }
};

const buildTypeSetting = (type: ParamSource['type']) => ({
  type: 'select',
  label: 'type',
  options: ['param buffer', 'constant', 'adsr', 'base frequency multiplier'],
  initial: type,
});

const PARAM_BUFFER_COUNT = 8;
const ADSR_COUNT = 8;

const setFrequency = (
  config: OperatorConfig,
  newFrequency: Partial<ParamSource>
): OperatorConfig => ({
  ...(config as any),
  frequency: { ...(config as any).frequency, ...newFrequency },
});

const setSpectralWarping = (
  config: OperatorConfig,
  newSpectralWarping: Partial<SpectralWarpingConfig>
): OperatorConfig => ({
  ...config,
  spectralWarping: {
    ...(config.spectralWarping || buildDefaultSpectralWarpingConfig()),
    ...newSpectralWarping,
  },
});

const ConfigureOperator: React.FC<{
  config: OperatorConfig;
  onChange: (newConfig: OperatorConfig) => void;
}> = ({ config, onChange }) => {
  const operatorTypeSettings = useMemo(
    () => [
      {
        type: 'select',
        label: 'operator type',
        options: [
          'sine oscillator',
          'exponential oscillator',
          'param buffer',
        ] as OperatorConfig['type'][],
      },
      {
        type: 'checkbox',
        label: 'enable spectral warping',
      },
    ],
    []
  );
  const baseFrequencySourceSettings = useMemo(() => {
    if (config.type !== 'sine oscillator' && config.type !== 'exponential oscillator') {
      return null;
    }
    const state = config.frequency;

    switch (state.type) {
      case 'param buffer': {
        return [
          buildTypeSetting(state.type),
          {
            type: 'select',
            label: 'buffer ix',
            options: new Array(PARAM_BUFFER_COUNT).fill(0).map((_i, i) => i),
            initial: state.bufferIx,
          },
        ];
      }
      case 'constant': {
        return [
          buildTypeSetting(state.type),
          { type: 'text', label: 'value', initial: state.value.toString() },
        ];
      }
      case 'adsr': {
        return [
          buildTypeSetting(state.type),
          {
            type: 'select',
            label: 'adsr index',
            options: new Array(ADSR_COUNT).fill(0).map((_i, i) => i),
            initial: state.adsrIx,
          },
        ];
      }
      case 'base frequency multiplier': {
        return [
          buildTypeSetting(state.type),
          {
            type: 'range',
            label: 'multiplier',
            min: 0,
            max: 16,
            step: 0.125,
            initial: state.multiplier.toString(),
          },
        ];
      }
      default: {
        console.error('Invalid operator state type: ', (state as any).type);
      }
    }
  }, [config.frequency, config.type]);

  const spectralWarpingSettings = useMemo(() => {
    if (!config.spectralWarping) {
      return null;
    }

    // TODO: Add rest
    return [{ type: 'range', label: 'warp factor', min: 0, max: 1 }];
  }, [config.spectralWarping]);

  return (
    <div className='operator-config'>
      <ControlPanel
        style={{ width: 378 }}
        settings={operatorTypeSettings}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'operator type': {
              onChange(buildDefaultOperatorConfig(val as OperatorConfig['type']));
              break;
            }
            case 'enable spectral warping': {
              onChange({
                ...config,
                spectralWarping: val ? buildDefaultSpectralWarpingConfig() : null,
              });
              break;
            }
            default: {
              console.error('Unhandled key in operator type control panel: ', key);
            }
          }
        }}
      />
      {baseFrequencySourceSettings ? (
        <ControlPanel
          style={{ width: 378 }}
          settings={baseFrequencySourceSettings}
          title='base frequency source'
          onChange={(key: string, value: any) => {
            switch (key) {
              case 'buffer ix': {
                onChange(setFrequency(config, { bufferIx: value }));
                break;
              }
              case 'value': {
                if (window.isNaN(value)) {
                  break;
                }
                onChange(setFrequency(config, { value }));
                break;
              }
              case 'adsr index': {
                onChange(setFrequency(config, { adsrIx: value }));
                break;
              }
              case 'multiplier': {
                if (window.isNaN(value)) {
                  break;
                }
                onChange(setFrequency(config, { multiplier: value }));
                break;
              }
              default: {
                console.error('Unhandled key in operator config settings: ', key);
              }
            }
          }}
        />
      ) : null}
      {config.type === 'exponential oscillator' ? (
        <ControlPanel
          title='exponential oscillator'
          style={{ width: 378 }}
          settings={[{ type: 'range', label: 'stretch factor', min: 0.3, max: 0.7 }]}
          onChange={(key: string, val: any) => {
            switch (key) {
              case 'stretch factor': {
                onChange({
                  ...config,
                  stretchFactor: {
                    type: 'constant',
                    value: val,
                  },
                });
                break;
              }
              default: {
                console.error('Unhandled key in stretch factor control panel: ', key);
              }
            }
          }}
        />
      ) : null}
      {spectralWarpingSettings && config.spectralWarping ? (
        <ControlPanel
          title='spectral warping'
          style={{ width: 378 }}
          settings={spectralWarpingSettings}
          onChange={(key: string, val: any) => {
            switch (key) {
              case 'warp factor': {
                onChange(
                  setSpectralWarping(config, { warpFactor: { type: 'constant', value: val } })
                );
                break;
              }
              default: {
                console.error('Unhandled spectral warping key: ', key);
              }
            }
          }}
        />
      ) : null}
    </div>
  );
};

export default ConfigureOperator;
