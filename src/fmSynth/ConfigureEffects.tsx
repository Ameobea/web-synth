import { filterNils } from 'ameo-utils';
import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { Option } from 'funfix-core';

import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import FlatButton from 'src/misc/FlatButton';
import { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

export enum ButterworthFilterMode {
  Lowpass = 0,
  Highpass = 1,
  Bandpass = 2,
}

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
  | { type: 'soft clipper'; preGain: ParamSource; postGain: ParamSource }
  | { type: 'butterworth filter'; mode: ButterworthFilterMode; cutoffFrequency: ParamSource };

const EFFECT_TYPE_SETTING = {
  type: 'select',
  label: 'effect type',
  options: [
    'spectral warping',
    'wavecruncher',
    'bitcrusher',
    'wavefolder',
    'soft clipper',
    'butterworth filter',
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
    case 'butterworth filter': {
      return {
        type,
        mode: ButterworthFilterMode.Lowpass,
        cutoffFrequency: { type: 'constant', value: 400 },
      };
    }
  }
};

const baseTheme = {
  background1: 'rgb(35,35,35)',
  background2: 'rgb(54,54,54)',
  background2hover: 'rgb(58,58,58)',
  foreground1: 'rgb(112,112,112)',
  text1: 'rgb(235,235,235)',
  text2: 'rgb(161,161,161)',
};
const spectralWarpTheme = { ...baseTheme, background2: 'rgb(24,38,56)' };
const wavecruncherTheme = { ...baseTheme, background2: 'rgb(19,14,18)' };
const bitcrusherTheme = { ...baseTheme, background2: 'rgb(24,14,4)' };
const wavefolderTheme = { ...baseTheme, background2: 'rgb(24,38,41)' };
const softClipperTheme = { ...baseTheme, background2: 'rgb(36,4,4)' };
const butterworthFilterTheme = { ...baseTheme, background2: 'rgb(49,22,13)' };

const ThemesByType: { [K in Effect['type']]: { [key: string]: any } } = {
  'spectral warping': spectralWarpTheme,
  wavecruncher: wavecruncherTheme,
  bitcrusher: bitcrusherTheme,
  wavefolder: wavefolderTheme,
  'soft clipper': softClipperTheme,
  'butterworth filter': butterworthFilterTheme,
};

type EffectConfigurator<T> = React.FC<{
  state: Extract<Effect, { type: T }>;
  onChange: (newState: Effect | null) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
}>;

const ConfigureSpectralWarping: EffectConfigurator<'spectral warping'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
}) => (
  <>
    <ConfigureParamSource
      theme={spectralWarpTheme}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      title='frequency'
      state={state.frequency}
      onChange={newFrequency => onChange({ ...state, frequency: newFrequency })}
      min={0}
      max={20_000}
    />
    <ConfigureParamSource
      theme={spectralWarpTheme}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      title='warp factor'
      state={state.warpFactor}
      onChange={newWarpFactor => onChange({ ...state, warpFactor: newWarpFactor })}
      min={0}
      max={1}
    />
  </>
);

const ConfigureWavecruncher: EffectConfigurator<'wavecruncher'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
}) => (
  <>
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      title='top fold position'
      state={state.topFoldPosition}
      onChange={topFoldPosition => onChange({ ...state, topFoldPosition })}
      min={0}
      max={1}
    />
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      title='top fold width'
      state={state.topFoldWidth}
      onChange={topFoldWidth => onChange({ ...state, topFoldWidth })}
      min={0}
      max={1}
    />
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      title='bottom fold position'
      state={state.bottomFoldPosition}
      onChange={bottomFoldPosition => onChange({ ...state, bottomFoldPosition })}
      min={-1}
      max={0}
    />
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      title='bottom fold width'
      state={state.bottomFoldWidth}
      onChange={bottomFoldWidth => onChange({ ...state, bottomFoldWidth })}
      min={0}
      max={1}
    />
  </>
);

const ConfigureBitcrusher: EffectConfigurator<'bitcrusher'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
}) => (
  <>
    <ConfigureParamSource
      title='sample rate'
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      theme={bitcrusherTheme}
      min={1}
      max={44_100}
      step={1}
      state={state.sampleRate}
      onChange={sampleRate => onChange({ ...state, sampleRate })}
    />
    <ConfigureParamSource
      title='bit depth'
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      theme={bitcrusherTheme}
      min={1}
      max={32}
      scale='log'
      state={state.bitDepth}
      onChange={bitDepth => onChange({ ...state, bitDepth })}
    />
  </>
);

const ConfigureWavefolder: EffectConfigurator<'wavefolder'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
}) => (
  <>
    <ConfigureParamSource
      title='gain'
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      theme={wavefolderTheme}
      min={0}
      max={16}
      state={state.gain}
      onChange={gain => onChange({ ...state, gain })}
    />
    <ConfigureParamSource
      title='offset'
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      theme={wavefolderTheme}
      min={0}
      max={8}
      state={state.offset}
      onChange={offset => onChange({ ...state, offset })}
    />
  </>
);

const ConfigureSoftClipper: EffectConfigurator<'soft clipper'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
}) => (
  <>
    <ConfigureParamSource
      title='pre gain'
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      theme={softClipperTheme}
      min={0.1}
      max={50}
      scale='log'
      state={state.preGain}
      onChange={preGain => onChange({ ...state, preGain })}
    />
    <ConfigureParamSource
      title='post gain'
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      theme={softClipperTheme}
      min={0.1}
      max={5}
      state={state.postGain}
      onChange={postGain => onChange({ ...state, postGain })}
    />
  </>
);

const BUTTERWORTH_FILTER_MODE_SETTINGS = [
  { type: 'select', label: 'mode', options: { lowpass: 0, highpass: 1, bandpass: 2 } },
];

const ConfigureButterworthFilter: EffectConfigurator<'butterworth filter'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
}) => (
  <>
    <ControlPanel
      settings={BUTTERWORTH_FILTER_MODE_SETTINGS}
      onChange={(_key: string, val: ButterworthFilterMode) => onChange({ ...state, mode: val })}
      state={{ mode: state.mode }}
    />
    <ConfigureParamSource
      title='cutoff frequency'
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      theme={butterworthFilterTheme}
      min={10}
      max={20_000}
      scale='log'
      state={state.cutoffFrequency}
      onChange={cutoffFrequency => onChange({ ...state, cutoffFrequency })}
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
      {/* <ControlPanel
        style={{ width: 376 }}
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
      /> */}
    </>
  );
};

export type AdsrChangeHandler = (adsrIx: number, newValue: Adsr) => void;

const ConfigureEffectSpecific: React.FC<{
  state: Effect;
  onChange: (newEffect: Effect | null) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
}> = ({ state, onChange, adsrs, onAdsrChange }) => {
  const Comp: EffectConfigurator<any> = useMemo(
    () =>
      ({
        'spectral warping': ConfigureSpectralWarping,
        wavecruncher: ConfigureWavecruncher,
        bitcrusher: ConfigureBitcrusher,
        wavefolder: ConfigureWavefolder,
        'soft clipper': ConfigureSoftClipper,
        'butterworth filter': ConfigureButterworthFilter,
      }[state.type]),
    [state.type]
  );

  return <Comp state={state} onChange={onChange} adsrs={adsrs} onAdsrChange={onAdsrChange} />;
};

const ConfigureEffect: React.FC<{
  effectIx: number;
  state: Effect;
  onChange: (newEffect: Effect | null) => void;
  operatorEffects: (Effect | null)[];
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
}> = ({ effectIx, operatorEffects, state, onChange, setOperatorEffects, adsrs, onAdsrChange }) => (
  <div className='configure-effect'>
    <EffectManagement
      effectIx={effectIx}
      operatorEffects={operatorEffects}
      setOperatorEffects={setOperatorEffects}
      onChange={onChange}
    />

    <ConfigureEffectSpecific
      state={state}
      onChange={onChange}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
    />
  </div>
);

const ConfigureEffects: React.FC<{
  state: (Effect | null)[];
  onChange: (ix: number, newState: Effect | null) => void;
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
  operatorIx: number | null;
}> = ({ state, onChange, setOperatorEffects, operatorIx, adsrs, onAdsrChange }) => {
  const [selectedEffectType, setSelectedEffectType] = useState<Effect['type']>('spectral warping');

  return (
    <div className='configure-effects'>
      <ControlPanel
        title={operatorIx === null ? 'main effect chain' : `operator ${operatorIx} effects`}
        style={{ width: 376 }}
      />
      <div className='effects-controls'>
        {filterNils(state).map((effect, i) => (
          <ConfigureEffect
            effectIx={i}
            key={i}
            state={effect}
            onChange={newEffect => onChange(i, newEffect)}
            operatorEffects={state}
            setOperatorEffects={setOperatorEffects}
            adsrs={adsrs}
            onAdsrChange={onAdsrChange}
          />
        ))}
      </div>

      <ControlPanel
        state={{ 'effect type': selectedEffectType }}
        style={{ width: 376 }}
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
