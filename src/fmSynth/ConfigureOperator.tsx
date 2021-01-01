import { UnreachableException } from 'ameo-utils';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import ConfigureEffects, { Effect } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource, {
  buildDefaultParamSource,
  ParamSource,
} from 'src/fmSynth/ConfigureParamSource';

/**
 * The algorithm used to produce the output for the operator.
 */
export type OperatorConfig =
  | { type: 'wavetable'; wavetableIx: number }
  | { type: 'sine oscillator'; frequency: ParamSource }
  | { type: 'exponential oscillator'; frequency: ParamSource; stretchFactor: ParamSource }
  | { type: 'param buffer'; bufferIx: number };

export const buildDefaultOperatorConfig = (
  type: OperatorConfig['type'] = 'sine oscillator'
): OperatorConfig => {
  switch (type) {
    case 'sine oscillator': {
      return {
        type,
        frequency: buildDefaultParamSource('base frequency multiplier'),
      };
    }
    case 'exponential oscillator': {
      return {
        type,
        frequency: buildDefaultParamSource('base frequency multiplier'),
        stretchFactor: { type: 'constant', value: 0.5 },
      };
    }
    case 'param buffer': {
      return { type, bufferIx: 0 };
    }
    default: {
      throw new UnreachableException('Unhandled type in `buildDefaultOperatorConfig`: ' + type);
    }
  }
};

const ConfigureOperator: React.FC<{
  config: OperatorConfig;
  onChange: (newConfig: OperatorConfig) => void;
  effects: (Effect | null)[];
  onEffectsChange: (effectIx: number, newEffect: Effect | null) => void;
  setEffects: (newEffects: (Effect | null)[]) => void;
}> = ({ config, onChange, effects, onEffectsChange, setEffects }) => {
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
    ],
    []
  );
  const operatorTypeState = useMemo(() => ({ 'operator type': config.type }), [config.type]);

  return (
    <div className='operator-config'>
      <ControlPanel
        style={{ width: 378 }}
        settings={operatorTypeSettings}
        state={operatorTypeState}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'operator type': {
              onChange(buildDefaultOperatorConfig(val as OperatorConfig['type']));
              break;
            }
            default: {
              console.error('Unhandled key in operator type control panel: ', key);
            }
          }
        }}
      />
      {config.type === 'sine oscillator' || config.type === 'exponential oscillator' ? (
        <ConfigureParamSource
          title='frequency'
          state={config.frequency}
          onChange={newFrequency => onChange({ ...config, frequency: newFrequency })}
          min={0}
          max={20000}
        />
      ) : null}
      {config.type === 'exponential oscillator' ? (
        <ConfigureParamSource
          title='stretch factor'
          state={config.stretchFactor}
          onChange={newStretchFactor => onChange({ ...config, stretchFactor: newStretchFactor })}
          min={0}
          max={1}
        />
      ) : null}
      <ConfigureEffects
        state={effects}
        onChange={onEffectsChange}
        setOperatorEffects={setEffects}
      />
    </div>
  );
};

export default ConfigureOperator;
