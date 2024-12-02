import { Option } from 'funfix-core';
import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import ConfigureParamSource from 'src/fmSynth/ConfigureParamSource';
import { ButterworthFilterMode, SoftClipperAlgorithm, type Effect } from 'src/fmSynth/Effect';
import type { ParamSource } from 'src/fmSynth/ParamSource';
import type { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import FlatButton from 'src/misc/FlatButton';
import HelpIcon from 'src/misc/HelpIcon';
import { getSentry } from 'src/sentry';
import { filterNils } from 'src/util';

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
    'delay',
    'moog filter',
    'comb filter',
    'compressor',
    'chorus',
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
        mix: { type: 'constant', value: 1 },
      };
    }
    case 'soft clipper': {
      return {
        type,
        preGain: { type: 'constant', value: 1.5 },
        postGain: { type: 'constant', value: 0.9 },
        mix: { type: 'constant', value: 1 },
        algorithm: SoftClipperAlgorithm.CubicNonlinearity,
      };
    }
    case 'butterworth filter': {
      return {
        type,
        mode: ButterworthFilterMode.Lowpass,
        cutoffFrequency: { type: 'constant', value: 400 },
      };
    }
    case 'delay': {
      return {
        type,
        delaySamples: { type: 'constant', value: 44_100 / 2 },
        wet: { type: 'constant', value: 0.7 },
        dry: { type: 'constant', value: 0.7 },
        feedback: { type: 'constant', value: 0.4 },
      };
    }
    case 'moog filter': {
      return {
        type,
        cutoffFrequency: { type: 'constant', value: 400 },
        resonance: { type: 'constant', value: 0.5 },
        drive: { type: 'constant', value: 0.5 },
      };
    }
    case 'comb filter': {
      return {
        type,
        delaySamples: { type: 'constant', value: 4100 },
        feedbackDelaySamples: { type: 'constant', value: 4100 },
        feedforwardGain: { type: 'constant', value: 0.8 },
        feedbackGain: { type: 'constant', value: 0.65 },
      };
    }
    case 'compressor': {
      return { type };
    }
    case 'chorus':
      return {
        type,
        dry: { type: 'constant', value: 0.5 },
        wet: { type: 'constant', value: 0.5 },
        lfoRate: { type: 'constant', value: 0.5 },
        modulationDepth: { type: 'constant', value: 0.5 },
      };
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
const delayTheme = { ...baseTheme, background2: 'rgb(13,107,89)' };
const moogFilterTheme = { ...baseTheme, background2: 'rgb(49,69,120)' };
const combFilterTheme = { ...baseTheme, background2: 'rgb(36,64,21)' };
const compressorTheme = { ...baseTheme, background2: 'rgb(16,24,21)' };
const chorusTheme = { ...baseTheme, background2: 'rgb(181,97,184)' };

export const ThemesByType: { [K in Effect['type']]: { [key: string]: any } } = {
  'spectral warping': spectralWarpTheme,
  wavecruncher: wavecruncherTheme,
  bitcrusher: bitcrusherTheme,
  wavefolder: wavefolderTheme,
  'soft clipper': softClipperTheme,
  'butterworth filter': butterworthFilterTheme,
  delay: delayTheme,
  'moog filter': moogFilterTheme,
  'comb filter': combFilterTheme,
  compressor: compressorTheme,
  chorus: chorusTheme,
};

const EMPTY_ADSRS: AdsrParams[] = [];

const adsrsMemoHelper = (param: ParamSource, adsrs: AdsrParams[]): AdsrParams[] => {
  // If the effect doesn't deal with ADSRs, don't bother re-rendering when ADSRs change
  if (param.type !== 'adsr') {
    return EMPTY_ADSRS;
  }
  return adsrs;
};

type EffectConfigurator<T> = React.FC<{
  state: Extract<Effect, { type: T }>;
  onChange: (newState: Partial<Effect> | null) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  vcId?: string;
}>;

const ConfigureSpectralWarping: EffectConfigurator<'spectral warping'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      theme={spectralWarpTheme}
      adsrs={adsrsMemoHelper(state.frequency, adsrs)}
      onAdsrChange={onAdsrChange}
      title='frequency'
      state={state.frequency}
      onChange={useCallback(newFrequency => onChange({ frequency: newFrequency }), [onChange])}
      min={0}
      max={20_000}
      vcId={vcId}
    />
    <ConfigureParamSource
      theme={spectralWarpTheme}
      adsrs={adsrsMemoHelper(state.warpFactor, adsrs)}
      onAdsrChange={onAdsrChange}
      title='warp factor'
      state={state.warpFactor}
      onChange={useCallback(newWarpFactor => onChange({ warpFactor: newWarpFactor }), [onChange])}
      min={0}
      max={1}
      vcId={vcId}
    />
  </>
);

const ConfigureWavecruncher: EffectConfigurator<'wavecruncher'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrsMemoHelper(state.topFoldPosition, adsrs)}
      onAdsrChange={onAdsrChange}
      title='top fold position'
      state={state.topFoldPosition}
      onChange={useCallback(topFoldPosition => onChange({ topFoldPosition }), [onChange])}
      min={0}
      max={1}
      vcId={vcId}
    />
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrsMemoHelper(state.topFoldWidth, adsrs)}
      onAdsrChange={onAdsrChange}
      title='top fold width'
      state={state.topFoldWidth}
      onChange={useCallback(topFoldWidth => onChange({ topFoldWidth }), [onChange])}
      min={0}
      max={1}
      vcId={vcId}
    />
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrsMemoHelper(state.bottomFoldPosition, adsrs)}
      onAdsrChange={onAdsrChange}
      title='bottom fold position'
      state={state.bottomFoldPosition}
      onChange={useCallback(bottomFoldPosition => onChange({ bottomFoldPosition }), [onChange])}
      min={-1}
      max={0}
      vcId={vcId}
    />
    <ConfigureParamSource
      theme={wavecruncherTheme}
      adsrs={adsrsMemoHelper(state.bottomFoldWidth, adsrs)}
      onAdsrChange={onAdsrChange}
      title='bottom fold width'
      state={state.bottomFoldWidth}
      onChange={useCallback(bottomFoldWidth => onChange({ bottomFoldWidth }), [onChange])}
      min={0}
      max={1}
      vcId={vcId}
    />
  </>
);

const ConfigureBitcrusher: EffectConfigurator<'bitcrusher'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      title='sample rate'
      adsrs={adsrsMemoHelper(state.sampleRate, adsrs)}
      scale='log'
      onAdsrChange={onAdsrChange}
      theme={bitcrusherTheme}
      min={100}
      max={44_100}
      state={state.sampleRate}
      onChange={useCallback(sampleRate => onChange({ sampleRate }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='bit depth'
      adsrs={adsrsMemoHelper(state.bitDepth, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={bitcrusherTheme}
      min={1}
      max={32}
      scale='log'
      state={state.bitDepth}
      onChange={useCallback(bitDepth => onChange({ bitDepth }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='mix'
      adsrs={adsrsMemoHelper(state.mix ?? { type: 'constant', value: 1 }, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={bitcrusherTheme}
      min={0}
      max={1}
      state={state.mix ?? { type: 'constant', value: 1 }}
      onChange={useCallback(mix => onChange({ mix }), [onChange])}
      vcId={vcId}
    />
  </>
);

const ConfigureWavefolder: EffectConfigurator<'wavefolder'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      title='gain'
      adsrs={adsrsMemoHelper(state.gain, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={wavefolderTheme}
      min={0}
      max={16}
      state={state.gain}
      onChange={useCallback(gain => onChange({ gain }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='offset'
      adsrs={adsrsMemoHelper(state.offset, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={wavefolderTheme}
      min={0}
      max={8}
      state={state.offset}
      onChange={useCallback(offset => onChange({ offset }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='mix'
      adsrs={adsrsMemoHelper(state.mix ?? { type: 'constant', value: 1 }, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={wavefolderTheme}
      min={0}
      max={1}
      state={state.mix ?? { type: 'constant', value: 1 }}
      onChange={useCallback(mix => onChange({ mix }), [onChange])}
      vcId={vcId}
    />
  </>
);

const SOFT_CLIPPER_ALGORITHM_SETTINGS = [
  {
    type: 'select',
    label: 'algorithm',
    options: {
      'cubic nonlinearity': 0,
      tanh: 1,
      'x / (1 + |x|)': 2,
      'hard clipper': 3,
      'bram wave shaper': 4,
    },
  },
];

const ConfigureSoftClipper: EffectConfigurator<'soft clipper'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ControlPanel
      theme={softClipperTheme}
      width={500}
      settings={SOFT_CLIPPER_ALGORITHM_SETTINGS}
      state={useMemo(() => ({ algorithm: state.algorithm }), [state.algorithm])}
      onChange={useCallback(
        (_key: string, val: SoftClipperAlgorithm) => onChange({ algorithm: val }),
        [onChange]
      )}
    />
    <ConfigureParamSource
      title='pre gain'
      adsrs={adsrsMemoHelper(state.preGain, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={softClipperTheme}
      min={0.1}
      max={50}
      scale='log'
      state={state.preGain}
      onChange={useCallback(preGain => onChange({ preGain }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='post gain'
      adsrs={adsrsMemoHelper(state.postGain, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={softClipperTheme}
      min={0.1}
      max={5}
      state={state.postGain}
      onChange={useCallback(postGain => onChange({ postGain }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='mix'
      adsrs={adsrsMemoHelper(state.mix ?? { type: 'constant', value: 1 }, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={softClipperTheme}
      min={0}
      max={1}
      state={state.mix ?? { type: 'constant', value: 1 }}
      onChange={useCallback(mix => onChange({ mix }), [onChange])}
      vcId={vcId}
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
  vcId,
}) => (
  <>
    <ControlPanel
      settings={BUTTERWORTH_FILTER_MODE_SETTINGS}
      onChange={(_key: string, val: ButterworthFilterMode) => onChange({ ...state, mode: val })}
      state={{ mode: state.mode }}
    />
    <ConfigureParamSource
      title='cutoff frequency'
      adsrs={adsrsMemoHelper(state.cutoffFrequency, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={butterworthFilterTheme}
      min={10}
      max={20_000}
      scale='log'
      state={state.cutoffFrequency}
      onChange={cutoffFrequency => onChange({ ...state, cutoffFrequency })}
      vcId={vcId}
    />
  </>
);

const ConfigureDelay: EffectConfigurator<'delay'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      title='delay_samples'
      adsrs={adsrsMemoHelper(state.delaySamples, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={delayTheme}
      min={1}
      max={44_100 * 10}
      scale='log'
      state={state.delaySamples}
      onChange={delaySamples => onChange({ ...state, delaySamples })}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='wet'
      adsrs={adsrsMemoHelper(state.wet, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={delayTheme}
      min={0}
      max={1}
      state={state.wet}
      onChange={wet => onChange({ ...state, wet })}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='dry'
      adsrs={adsrsMemoHelper(state.dry, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={delayTheme}
      min={0}
      max={1}
      state={state.dry}
      onChange={dry => onChange({ ...state, dry })}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='feedback'
      adsrs={adsrsMemoHelper(state.feedback, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={delayTheme}
      min={0}
      max={1}
      state={state.feedback}
      onChange={feedback => onChange({ ...state, feedback })}
      vcId={vcId}
    />
  </>
);

const ConfigureMoogFilter: EffectConfigurator<'moog filter'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      title='cutoff frequency'
      adsrs={adsrsMemoHelper(state.cutoffFrequency, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={moogFilterTheme}
      min={1}
      max={41_000 / 2 - 2000}
      scale='log'
      state={state.cutoffFrequency}
      onChange={useCallback(cutoffFrequency => onChange({ cutoffFrequency }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='resonance'
      adsrs={adsrsMemoHelper(state.resonance, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={moogFilterTheme}
      min={0.3}
      max={4.5}
      state={state.resonance}
      onChange={useCallback(resonance => onChange({ resonance }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='drive'
      adsrs={adsrsMemoHelper(state.drive, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={moogFilterTheme}
      min={0}
      max={5}
      state={state.drive}
      onChange={useCallback(drive => onChange({ drive }), [onChange])}
      vcId={vcId}
    />
  </>
);

const ConfigureCombFilter: EffectConfigurator<'comb filter'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      title='delay (samples)'
      adsrs={adsrsMemoHelper(state.delaySamples, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={combFilterTheme}
      min={1}
      max={44_100 * 4 - 1}
      scale='log'
      state={state.delaySamples}
      onChange={useCallback(delaySamples => onChange({ delaySamples }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='feedforward gain'
      adsrs={adsrsMemoHelper(state.feedforwardGain, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={combFilterTheme}
      min={0}
      max={1}
      state={state.feedforwardGain}
      onChange={useCallback(feedforwardGain => onChange({ feedforwardGain }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='feedback delay (samples)'
      adsrs={adsrsMemoHelper(state.feedbackDelaySamples, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={combFilterTheme}
      min={1}
      max={44_100 * 4 - 1}
      scale='log'
      state={state.feedbackDelaySamples}
      onChange={useCallback(feedbackDelaySamples => onChange({ feedbackDelaySamples }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='feedback gain'
      adsrs={adsrsMemoHelper(state.feedbackGain, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={combFilterTheme}
      min={0}
      max={1}
      state={state.feedbackGain}
      onChange={useCallback(feedbackGain => onChange({ feedbackGain }), [onChange])}
      vcId={vcId}
    />
  </>
);

const ConfigureCompressor: EffectConfigurator<'compressor'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => <>Compressor params TODO</>;

const ConfigureChorus: EffectConfigurator<'chorus'> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => (
  <>
    <ConfigureParamSource
      title='dry'
      adsrs={adsrsMemoHelper(state.dry, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={chorusTheme}
      min={0}
      max={1}
      state={state.dry}
      onChange={useCallback(dry => onChange({ dry }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='wet'
      adsrs={adsrsMemoHelper(state.wet, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={chorusTheme}
      min={0}
      max={1}
      state={state.wet}
      onChange={useCallback(wet => onChange({ wet }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='lfo rate'
      adsrs={adsrsMemoHelper(state.lfoRate, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={chorusTheme}
      min={0.02}
      max={8}
      scale='log'
      state={state.lfoRate}
      onChange={useCallback(lfoRate => onChange({ lfoRate }), [onChange])}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='modulation depth'
      adsrs={adsrsMemoHelper(state.modulationDepth, adsrs)}
      onAdsrChange={onAdsrChange}
      theme={chorusTheme}
      min={0}
      max={1}
      state={state.modulationDepth}
      onChange={useCallback(modulationDepth => onChange({ modulationDepth }), [onChange])}
      vcId={vcId}
    />
  </>
);

interface EffectManagementProps {
  effectIx: number;
  isBypassed: boolean;
  operatorEffects: (Effect | null)[];
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
  onChange: (newEffect: Partial<Effect> | null) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const EffectManagement: React.FC<EffectManagementProps> = ({
  effectIx,
  isBypassed,
  operatorEffects,
  setOperatorEffects,
  onChange,
  collapsed,
  setCollapsed,
}) => {
  const theme = Option.of(operatorEffects[effectIx]?.type)
    .map(type => ThemesByType[type])
    .orUndefined();

  return (
    <>
      <div
        className='effect-management'
        style={{ backgroundColor: theme?.background1, paddingBottom: collapsed ? 20 : 0 }}
      >
        <FlatButton onClick={() => onChange(null)}>×</FlatButton>
        {effectIx !== 0 ? (
          <FlatButton
            onClick={() => {
              getSentry()?.captureMessage('Shift FM synth effect position', {
                extra: { direction: 'up', effectIx },
              });
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
              getSentry()?.captureMessage('Shift FM synth effect position', {
                extra: { direction: 'down', effectIx },
              });
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
        {effectIx === 0 || !operatorEffects[effectIx + 1] ? (
          <div className='button-placeholder' />
        ) : null}

        <input
          className='bypass-checkbox'
          type='checkbox'
          checked={isBypassed}
          onChange={() => onChange({ isBypassed: !isBypassed })}
        />
        <label style={{ fontSize: 10, color: '#888' }}>bypass</label>
        <div className='effect-title'>{operatorEffects[effectIx]?.type}</div>
        <FlatButton className='toggle-collapsed' onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '>' : 'v'}
        </FlatButton>
      </div>
    </>
  );
};

export type AdsrChangeHandler = (adsrIx: number, newValue: AdsrParams) => void;

const EFFECT_CONFIGURATOR_BY_EFFECT_TYPE: { [K in Effect['type']]: EffectConfigurator<K> } = {
  'spectral warping': React.memo(ConfigureSpectralWarping),
  wavecruncher: React.memo(ConfigureWavecruncher),
  bitcrusher: React.memo(ConfigureBitcrusher),
  wavefolder: React.memo(ConfigureWavefolder),
  'soft clipper': React.memo(ConfigureSoftClipper),
  'butterworth filter': React.memo(ConfigureButterworthFilter),
  delay: React.memo(ConfigureDelay),
  'moog filter': React.memo(ConfigureMoogFilter),
  'comb filter': React.memo(ConfigureCombFilter),
  compressor: React.memo(ConfigureCompressor),
  chorus: React.memo(ConfigureChorus),
};

interface ConfigureEffectSpecificProps {
  state: Effect;
  onChange: (newEffect: Partial<Effect> | null) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  vcId?: string;
}

const ConfigureEffectSpecific: React.FC<ConfigureEffectSpecificProps> = ({
  state,
  onChange,
  adsrs,
  onAdsrChange,
  vcId,
}) => {
  const Comp: EffectConfigurator<any> = useMemo(
    () => EFFECT_CONFIGURATOR_BY_EFFECT_TYPE[state.type],
    [state.type]
  );

  return (
    <Comp state={state} onChange={onChange} adsrs={adsrs} onAdsrChange={onAdsrChange} vcId={vcId} />
  );
};

interface ConfigureEffectProps {
  effectIx: number;
  state: Effect;
  onChange: (newEffect: Partial<Effect> | null) => void;
  operatorEffects: (Effect | null)[];
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  vcId?: string;
}

const ConfigureEffect: React.FC<ConfigureEffectProps> = ({
  effectIx,
  operatorEffects,
  state,
  onChange,
  setOperatorEffects,
  adsrs,
  onAdsrChange,
  vcId,
}) => {
  return (
    <div className='configure-effect'>
      <EffectManagement
        effectIx={effectIx}
        operatorEffects={operatorEffects}
        setOperatorEffects={setOperatorEffects}
        onChange={onChange}
        collapsed={state.isCollapsed ?? false}
        setCollapsed={useCallback(
          () => onChange({ isCollapsed: !state.isCollapsed }),
          [onChange, state.isCollapsed]
        )}
        isBypassed={state.isBypassed ?? false}
      />

      {state.isCollapsed ? null : (
        <ConfigureEffectSpecific
          state={state}
          onChange={onChange}
          adsrs={adsrs}
          onAdsrChange={onAdsrChange}
          vcId={vcId}
        />
      )}
    </div>
  );
};

export interface ConfigureEffectsProps {
  state: (Effect | null)[];
  onChange: (ix: number, newState: Partial<Effect> | null) => void;
  setOperatorEffects: (newOperatorEffects: (Effect | null)[]) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  operatorIx: number | null;
  vcId: string | undefined;
}

interface ConfigureEffectsState {
  selectedEffectType: Effect['type'];
}

const MAX_EFFECT_COUNT = 16;

class ConfigureEffects extends React.Component<ConfigureEffectsProps, ConfigureEffectsState> {
  constructor(props: ConfigureEffectsProps) {
    super(props);

    this.state = { selectedEffectType: 'moog filter' };

    this.effectChangeHandlers = new Array(MAX_EFFECT_COUNT)
      .fill(null)
      .map((_, i) => effectUpdate => this.props.onChange(i, effectUpdate));
  }

  private effectChangeHandlers: ((newEffect: Partial<Effect> | null) => void)[];

  public render() {
    const { state, onChange, setOperatorEffects, operatorIx, adsrs, onAdsrChange, vcId } =
      this.props;

    return (
      <div className='configure-effects'>
        <ControlPanel
          title={
            operatorIx === null ? (
              <>
                {'main effect chain '}
                <HelpIcon link='fm-synth-main-effect-chain' color='rgb(161, 161, 161)' size={12} />
              </>
            ) : (
              `operator ${operatorIx + 1} effects`
            )
          }
          style={{ width: 500 }}
        />
        <div className='effects-controls'>
          {filterNils(state).map((effect, i) => (
            <ConfigureEffect
              effectIx={i}
              key={i}
              state={effect}
              onChange={this.effectChangeHandlers[i]}
              operatorEffects={state}
              setOperatorEffects={setOperatorEffects}
              adsrs={adsrs}
              onAdsrChange={onAdsrChange}
              vcId={vcId}
            />
          ))}
        </div>

        <ControlPanel
          state={{ 'effect type': this.state.selectedEffectType }}
          width={470}
          onChange={(_key: string, val: any) => this.setState({ selectedEffectType: val })}
          settings={[
            EFFECT_TYPE_SETTING,
            {
              type: 'button',
              label: 'add effect',
              action: () => {
                getSentry()?.captureMessage('Add FM Synth Effect', {
                  extra: { selectedEffectType: this.state.selectedEffectType },
                });
                const activeEffectCount = state.filter(e => e).length;
                if (activeEffectCount === state.length) {
                  // Max effect count reached
                  alert('Max effect count reached');
                  return;
                }

                onChange(activeEffectCount, buildDefaultEffect(this.state.selectedEffectType));
              },
            },
          ]}
        />
      </div>
    );
  }
}

export default ConfigureEffects;
