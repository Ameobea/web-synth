import { filterNils } from 'ameo-utils';
import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';

export type Effect =
  | {
      type: 'spectral warping';
      frequency: ParamSource;
      warpFactor: ParamSource;
      phaseOffset: number;
    }
  | {
      type: 'wavefolder';
      topFoldPosition: ParamSource;
      topFoldWidth: ParamSource;
      bottomFoldPosition: ParamSource;
      bottomFoldWidth: ParamSource;
    };

const buildDefaultEffect = (type: Effect['type']): Effect => {
  switch (type) {
    case 'spectral warping': {
      return {
        type,
        frequency: { type: 'base frequency multiplier', multiplier: 1 },
        warpFactor: { type: 'constant', value: 0.7 },
        phaseOffset: 0,
      };
    }
    case 'wavefolder': {
      return {
        type,
        topFoldPosition: { type: 'constant', value: 0.8 },
        topFoldWidth: { type: 'constant', value: 0.25 },
        bottomFoldPosition: { type: 'constant', value: 0.8 },
        bottomFoldWidth: { type: 'constant', value: 0.25 },
      };
    }
  }
};

const ConfigureSpectralWarping: React.FC<{
  state: Extract<Effect, { type: 'spectral warping' }>;
  onChange: (newState: Effect | null) => void;
}> = ({ state, onChange }) => {
  return (
    <>
      <ConfigureParamSource
        title='frequency'
        state={state.frequency}
        onChange={newFrequency => onChange({ ...state, frequency: newFrequency })}
      />
      <ConfigureParamSource
        title='warp factor'
        state={state.warpFactor}
        onChange={newWarpFactor => onChange({ ...state, warpFactor: newWarpFactor })}
      />
    </>
  );
};

const ConfigureWavefolder: React.FC<{
  state: Extract<Effect, { type: 'wavefolder' }>;
  onChange: (newState: Effect | null) => void;
}> = ({ state, onChange }) => {
  return (
    <>
      <ConfigureParamSource
        title='top fold position'
        state={state.topFoldPosition}
        onChange={topFoldPosition => onChange({ ...state, topFoldPosition })}
      />
      <ConfigureParamSource
        title='top fold width'
        state={state.topFoldWidth}
        onChange={topFoldWidth => onChange({ ...state, topFoldWidth })}
      />
      <ConfigureParamSource
        title='bottom fold position'
        state={state.bottomFoldPosition}
        onChange={bottomFoldPosition => onChange({ ...state, bottomFoldPosition })}
      />
      <ConfigureParamSource
        title='bottom fold width'
        state={state.bottomFoldWidth}
        onChange={bottomFoldWidth => onChange({ ...state, bottomFoldWidth })}
      />
    </>
  );
};

const ConfigureEffectSpecific: React.FC<{
  state: Effect;
  onChange: (newEffect: Effect | null) => void;
}> = ({ state, onChange }) => {
  switch (state.type) {
    case 'spectral warping': {
      return <ConfigureSpectralWarping state={state} onChange={onChange} />;
    }
    case 'wavefolder': {
      return <ConfigureWavefolder state={state} onChange={onChange} />;
    }
  }
};

const ConfigureEffect: React.FC<{
  state: Effect;
  onChange: (newEffect: Effect | null) => void;
}> = ({ state, onChange }) => {
  return (
    <>
      <ControlPanel
        settings={[
          {
            type: 'select',
            label: 'effect type',
            options: ['spectral warping', 'wavefolder'] as Effect['type'][],
          },
        ]}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'effect type': {
              // TODO
              break;
            }
            default: {
              console.error('Unhandled effect configurator key: ', key);
            }
          }
        }}
      />
      <ConfigureEffectSpecific state={state} onChange={onChange} />
    </>
  );
};

const ConfigureEffects: React.FC<{
  state: (Effect | null)[];
  onChange: (ix: number, newState: Effect | null) => void;
}> = ({ state, onChange }) => {
  const [selectedEffectType, setSelectedEffectType] = useState<Effect['type']>('spectral warping');

  return (
    <div className='configure-effects'>
      {filterNils(state).map((effect, i) => (
        <ConfigureEffect key={i} state={effect} onChange={newEffect => onChange(i, newEffect)} />
      ))}

      <ControlPanel
        state={{ 'effect type': selectedEffectType }}
        onChange={(_key: string, val: any) => setSelectedEffectType(val)}
        settings={[
          {
            type: 'select',
            label: 'effect type',
            options: ['spectral warping', 'wavefolder'] as Effect['type'][],
          },
          {
            type: 'button',
            label: 'add effect',
            action: () => {
              const activeEffectCount = state.filter(e => e).length;
              if (activeEffectCount === state.length) {
                // Max effect count reached
                return;
              }

              onChange(activeEffectCount, buildDefaultEffect(selectedEffectType));
            },
          },
        ]}
      />
    </div>
  );
};

export default ConfigureEffects;
