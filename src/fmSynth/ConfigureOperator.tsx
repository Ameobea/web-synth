import { UnreachableException } from 'ameo-utils';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import ConfigureEffects, { AdsrChangeHandler, Effect } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource, {
  buildDefaultParamSource,
  ParamSource,
} from 'src/fmSynth/ConfigureParamSource';
import { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

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
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
      };
    }
    case 'exponential oscillator': {
      return {
        type,
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
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
  operatorIx: number;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
}> = ({
  config,
  onChange,
  effects,
  onEffectsChange,
  setEffects,
  operatorIx,
  adsrs,
  onAdsrChange,
}) => {
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
        style={{ width: 470 }}
        settings={operatorTypeSettings}
        title={`configure operator ${operatorIx}`}
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
          adsrs={adsrs}
          onAdsrChange={onAdsrChange}
        />
      ) : null}
      {config.type === 'exponential oscillator' ? (
        <ConfigureParamSource
          title='stretch factor'
          state={config.stretchFactor}
          onChange={newStretchFactor => onChange({ ...config, stretchFactor: newStretchFactor })}
          min={0}
          max={1}
          adsrs={adsrs}
          onAdsrChange={onAdsrChange}
        />
      ) : null}
      <ConfigureEffects
        operatorIx={operatorIx}
        state={effects}
        onChange={onEffectsChange}
        setOperatorEffects={setEffects}
        adsrs={adsrs}
        onAdsrChange={onAdsrChange}
      />
    </div>
  );
};

export default ConfigureOperator;
