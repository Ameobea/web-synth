import { filterNils } from 'ameo-utils';
import React, { useState } from 'react';
import ControlPanel from 'react-control-panel';
import { Option } from 'funfix-core';

import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import FlatButton from 'src/misc/FlatButton';

export type Effect =
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
  | { type: 'bitcrusher'; sampleRate: ParamSource; bitDepth: ParamSource }
  | { type: 'wavefolder'; gain: ParamSource; offset: ParamSource }
  | { type: 'soft clipper'; preGain: ParamSource; postGain: ParamSource };

const EFFECT_TYPE_SETTING = {
  type: 'select',
  label: 'effect type',
  options: [
    'spectral warping',
    'wavecruncher',
    'bitcrusher',
    'wavefolder',
    'soft clipper',
  ] as Effect['type'][],
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
    case 'wavecruncher': {
      return {
        type,
        topFoldPosition: { type: 'constant', value: 0.8 },
        topFoldWidth: { type: 'constant', value: 0.25 },
        bottomFoldPosition: { type: 'constant', value: -0.8 },
        bottomFoldWidth: { type: 'constant', value: 0.25 },
      };
    }
    case 'bitcrusher': {
      return {
        type,
        sampleRate: { type: 'constant', value: 44_100 },
        bitDepth: { type: 'constant', value: 32 },
      };
    }
    case 'wavefolder': {
      return {
        type,
        gain: { type: 'constant', value: 1.5 },
        offset: { type: 'constant', value: 0 },
      };
    }
    case 'soft clipper': {
      return {
        type,
        preGain: { type: 'constant', value: 1.5 },
        postGain: { type: 'constant', value: 1.5 },
      };
    }
  }
};

const baseTheme = {
  background2: 'rgb(54,54,54)',
  background2hover: 'rgb(58,58,58)',
  foreground1: 'rgb(112,112,112)',
  text1: 'rgb(235,235,235)',
  text2: 'rgb(161,161,161)',
};
const spectralWarpTheme = { ...baseTheme, background1: 'rgb(24,48,182)' };
const wavecruncherTheme = { ...baseTheme, background1: 'rgb(199,48,184)' };
const bitcrusherTheme = { ...baseTheme, background1: 'rgb(84,47,12)' };
const wavefolderTheme = { ...baseTheme, background1: 'rgb(24,120,101)' };
const softClipperTheme = { ...baseTheme, background1: 'rgb(88,88,22)' };

const ThemesByType: { [K in Effect['type']]: { [key: string]: any } } = {
  'spectral warping': spectralWarpTheme,
  wavecruncher: wavecruncherTheme,
  bitcrusher: bitcrusherTheme,
  wavefolder: wavefolderTheme,
  'soft clipper': softClipperTheme,
};

type EffectConfigurator<T> = React.FC<{
  state: Extract<Effect, { type: T }>;
  onChange: (newState: Effect | null) => void;
}>;

const ConfigureSpectralWarping: EffectConfigurator<'spectral warping'> = ({ state, onChange }) => {
  return (
    <>
      <ConfigureParamSource
        theme={spectralWarpTheme}
        title='frequency'
        state={state.frequency}
        onChange={newFrequency => onChange({ ...state, frequency: newFrequency })}
        min={0}
        max={20_000}
      />
      <ConfigureParamSource
        theme={spectralWarpTheme}
        title='warp factor'
        state={state.warpFactor}
        onChange={newWarpFactor => onChange({ ...state, warpFactor: newWarpFactor })}
        min={0}
        max={1}
      />
    </>
  );
};

const ConfigureWavecruncher: React.FC<{
  state: Extract<Effect, { type: 'wavecruncher' }>;
  onChange: (newState: Effect | null) => void;
}> = ({ state, onChange }) => {
  return (
    <>
      <ConfigureParamSource
        theme={wavecruncherTheme}
        title='top fold position'
        state={state.topFoldPosition}
        onChange={topFoldPosition => onChange({ ...state, topFoldPosition })}
        min={0}
        max={1}
      />
      <ConfigureParamSource
        theme={wavecruncherTheme}
        title='top fold width'
        state={state.topFoldWidth}
        onChange={topFoldWidth => onChange({ ...state, topFoldWidth })}
        min={0}
        max={1}
      />
      <ConfigureParamSource
        theme={wavecruncherTheme}
        title='bottom fold position'
        state={state.bottomFoldPosition}
        onChange={bottomFoldPosition => onChange({ ...state, bottomFoldPosition })}
        min={-1}
        max={0}
      />
      <ConfigureParamSource
        theme={wavecruncherTheme}
        title='bottom fold width'
        state={state.bottomFoldWidth}
        onChange={bottomFoldWidth => onChange({ ...state, bottomFoldWidth })}
        min={0}
        max={1}
      />
    </>
  );
};

const ConfigureBitcrusher: EffectConfigurator<'bitcrusher'> = ({ state, onChange }) => (
  <>
    <ConfigureParamSource
      title='sample rate'
      theme={bitcrusherTheme}
      min={1}
      max={4410}
      step={1}
      state={state.sampleRate}
      onChange={sampleRate => onChange({ ...state, sampleRate })}
    />
    <ConfigureParamSource
      title='bit depth'
      theme={bitcrusherTheme}
      min={1}
      max={32}
      scale='log'
      state={state.bitDepth}
      onChange={bitDepth => onChange({ ...state, bitDepth })}
    />
  </>
);

const ConfigureWavefolder: EffectConfigurator<'wavefolder'> = ({ state, onChange }) => (
  <>
    <ConfigureParamSource
      title='gain'
      theme={wavefolderTheme}
      min={0}
      max={16}
      state={state.gain}
      onChange={gain => onChange({ ...state, gain })}
    />
    <ConfigureParamSource
      title='offset'
      theme={wavefolderTheme}
      min={0}
      max={8}
      state={state.offset}
      onChange={offset => onChange({ ...state, offset })}
    />
  </>
);

const ConfigureSoftClipper: EffectConfigurator<'soft clipper'> = ({ state, onChange }) => (
  <>
    <ConfigureParamSource
      title='pre gain'
      theme={softClipperTheme}
      min={0.1}
      max={50}
      scale='log'
      state={state.preGain}
      onChange={preGain => onChange({ ...state, preGain })}
    />
    <ConfigureParamSource
      title='post gain'
      theme={softClipperTheme}
      min={0.1}
      max={5}
      state={state.postGain}
      onChange={postGain => onChange({ ...state, postGain })}
    />
  </>
);

const EffectManagement: React.FC<{
  effectIx: number;
  operatorEffects: (Effect | null)[];
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
  onChange: (newEffect: Effect | null) => void;
}> = ({ effectIx, operatorEffects, setOperatorEffects, onChange }) => {
  const theme = Option.of(operatorEffects[effectIx]?.type)
    .map(type => ThemesByType[type])
    .orUndefined();

  return (
    <>
      <div className='effect-management' style={{ backgroundColor: theme?.background1 }}>
        <FlatButton onClick={() => onChange(null)}>×</FlatButton>
        {effectIx !== 0 ? (
          <FlatButton
            onClick={() => {
              const newEffects = [...operatorEffects];
              const swapEffect = operatorEffects[effectIx - 1];
              newEffects[effectIx - 1] = newEffects[effectIx];
              newEffects[effectIx] = swapEffect;
              setOperatorEffects(newEffects);
            }}
          >
            ↑
          </FlatButton>
        ) : null}
        {operatorEffects[effectIx + 1] ? (
          <FlatButton
            onClick={() => {
              const newEffects = [...operatorEffects];
              const swapEffect = operatorEffects[effectIx + 1];
              newEffects[effectIx + 1] = newEffects[effectIx];
              newEffects[effectIx] = swapEffect;
              setOperatorEffects(newEffects);
            }}
          >
            ↓
          </FlatButton>
        ) : null}
        <div className='effect-title'>{operatorEffects[effectIx]?.type}</div>
      </div>
      <ControlPanel
        style={{ width: 378 }}
        theme={theme}
        state={{ 'effect type': operatorEffects[effectIx]?.type }}
        settings={[EFFECT_TYPE_SETTING]}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'effect type': {
              onChange({ ...(operatorEffects[effectIx] ?? {}), ...buildDefaultEffect(val) });
              break;
            }
            default: {
              console.error('Unhandled effect configurator key: ', key);
            }
          }
        }}
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
    case 'wavecruncher': {
      return <ConfigureWavecruncher state={state} onChange={onChange} />;
    }
    case 'bitcrusher': {
      return <ConfigureBitcrusher state={state} onChange={onChange} />;
    }
    case 'wavefolder': {
      return <ConfigureWavefolder state={state} onChange={onChange} />;
    }
    case 'soft clipper': {
      return <ConfigureSoftClipper state={state} onChange={onChange} />;
    }
  }
};

const ConfigureEffect: React.FC<{
  effectIx: number;
  state: Effect;
  onChange: (newEffect: Effect | null) => void;
  operatorEffects: (Effect | null)[];
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
}> = ({ effectIx, operatorEffects, state, onChange, setOperatorEffects }) => {
  return (
    <>
      <EffectManagement
        effectIx={effectIx}
        operatorEffects={operatorEffects}
        setOperatorEffects={setOperatorEffects}
        onChange={onChange}
      />

      <ConfigureEffectSpecific state={state} onChange={onChange} />
    </>
  );
};

const ConfigureEffects: React.FC<{
  state: (Effect | null)[];
  onChange: (ix: number, newState: Effect | null) => void;
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
}> = ({ state, onChange, setOperatorEffects }) => {
  const [selectedEffectType, setSelectedEffectType] = useState<Effect['type']>('spectral warping');

  return (
    <div className='configure-effects'>
      <div className='effects-controls'>
        {filterNils(state).map((effect, i) => (
          <ConfigureEffect
            effectIx={i}
            key={i}
            state={effect}
            onChange={newEffect => onChange(i, newEffect)}
            operatorEffects={state}
            setOperatorEffects={setOperatorEffects}
          />
        ))}
      </div>

      <ControlPanel
        state={{ 'effect type': selectedEffectType }}
        style={{ width: 378 }}
        onChange={(_key: string, val: any) => setSelectedEffectType(val)}
        settings={[
          EFFECT_TYPE_SETTING,
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
