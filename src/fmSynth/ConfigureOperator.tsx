import React, { Suspense, useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import type { Writable } from 'svelte/store';

import { renderModalWithControls, renderSvelteModalWithControls } from 'src/controls/Modal';
import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
import ConfigureEffects, { type AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource, { PARAM_BUFFER_COUNT } from 'src/fmSynth/ConfigureParamSource';
import type { Effect } from 'src/fmSynth/Effect';
import type { GateUngateCallbackRegistrar } from 'src/fmSynth/midiSampleUI/types';
import { buildDefaultParamSource, type ParamSource } from 'src/fmSynth/ParamSource';
import type { UploadWavetableModalProps } from 'src/fmSynth/Wavetable/UploadWavetable';
import type { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import type { SampleMappingState } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
import { mkSvelteComponentShim } from 'src/svelteUtils';
import { UnreachableError, base64ArrayBuffer, base64ToArrayBuffer } from 'src/util';
import ConfigureSampleMappingInner from './midiSampleUI/ConfigureSampleMapping.svelte';
import type { WavetablePreset } from 'src/api';

interface UnisonPhaseRandomizationConfig {
  enabled: boolean;
}

/**
 * The algorithm used to produce the output for the operator.
 */
export type OperatorConfig =
  | {
      type: 'wavetable';
      wavetableName: string | null;
      frequency: ParamSource;
      dim0IntraMix: ParamSource;
      dim1IntraMix: ParamSource;
      interDimMix: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | {
      type: 'sine oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | {
      type: 'exponential oscillator';
      frequency: ParamSource;
      stretchFactor: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | { type: 'param buffer'; bufferIx: number }
  | {
      type: 'square oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | {
      type: 'triangle oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | {
      type: 'sawtooth oscillator';
      frequency: ParamSource;
      unison: number;
      unisonDetune: ParamSource;
      unisonPhaseRandomization: UnisonPhaseRandomizationConfig;
    }
  | { type: 'sample mapping' }
  | { type: 'tuned sample' }
  | { type: 'white noise' };

export const buildDefaultOperatorConfig = (
  type: OperatorConfig['type'] = 'sine oscillator'
): OperatorConfig => {
  switch (type) {
    case 'sine oscillator':
    case 'square oscillator':
    case 'triangle oscillator':
    case 'sawtooth oscillator': {
      return {
        type,
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
        unison: 1,
        unisonDetune: buildDefaultParamSource('constant', 0, 300, 1),
        unisonPhaseRandomization: { enabled: false },
      };
    }
    case 'exponential oscillator': {
      return {
        type,
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
        stretchFactor: { type: 'constant', value: 0.5 },
        unisonPhaseRandomization: { enabled: false },
      };
    }
    case 'param buffer': {
      return { type, bufferIx: 0 };
    }
    case 'wavetable': {
      return {
        type,
        wavetableName: null,
        frequency: buildDefaultParamSource('base frequency multiplier', 10, 20_000),
        dim0IntraMix: buildDefaultParamSource('constant', 0, 1, 0.5),
        dim1IntraMix: buildDefaultParamSource('constant', 0, 1, 0.5),
        interDimMix: buildDefaultParamSource('constant', 0, 1, 0.5),
        unison: 1,
        unisonDetune: buildDefaultParamSource('constant', 0, 300, 1),
        unisonPhaseRandomization: { enabled: false },
      };
    }
    case 'sample mapping': {
      return { type };
    }
    case 'white noise': {
      return { type };
    }
    default: {
      throw new UnreachableError('Unhandled type in `buildDefaultOperatorConfig`: ' + type);
    }
  }
};

export interface WavetableBank {
  name: string;
  samples: Float32Array;
  samplesPerWaveform: number;
  waveformsPerDimension: number;
  baseFrequency: number;
  preset?: WavetablePreset;
}

export interface WavetableState {
  wavetableBanks: readonly WavetableBank[];
}

export const serializeWavetableState = (state: WavetableState) => {
  return {
    wavetableBanks: state.wavetableBanks.map(bank => ({
      ...bank,
      samples: base64ArrayBuffer(bank.samples.buffer),
    })),
  };
};

export const deserializeWavetableState = (
  serialized: ReturnType<typeof serializeWavetableState>
): WavetableState => {
  return {
    wavetableBanks: serialized.wavetableBanks.map(bank => ({
      ...bank,
      samples: new Float32Array(base64ToArrayBuffer(bank.samples)),
    })),
  };
};

interface ConfigureWavetableIndexProps {
  selectedWavetableName: string | null;
  wavetableState: WavetableState;
  setWavetableState: React.Dispatch<React.SetStateAction<WavetableState>>;
  setSelectedWavetableName: (newName: string | null) => void;
  useLegacyControls: boolean;
  setUseLegacyControls: (newVal: boolean) => void;
}

const ConfigureWavetableIndex: React.FC<ConfigureWavetableIndexProps> = ({
  selectedWavetableName,
  wavetableState,
  setWavetableState,
  setSelectedWavetableName,
  useLegacyControls,
  setUseLegacyControls,
}) => {
  const state = useMemo(
    () => ({ wavetable: selectedWavetableName ?? '' }),
    [selectedWavetableName]
  );
  const settings: ControlPanelSetting[] = useMemo(() => {
    if (!useLegacyControls) {
      return [
        {
          type: 'custom',
          label: 'wavetable',
          Comp: ({ value }) => (
            <span style={{ color: value ? '#4dcbcb' : 'orange' }}>
              {value || <i>No wavetable selected</i>}
            </span>
          ),
        },
        {
          type: 'button',
          label: 'configure wavetable',
          action: async () => {
            const WavetableConfigurator = (await import('./Wavetable/WavetableConfigurator.svelte'))
              .default;
            const curBank = wavetableState.wavetableBanks.find(
              bank => bank.name === selectedWavetableName
            );
            console.log({ curBank });
            try {
              const newBank = await renderSvelteModalWithControls(
                WavetableConfigurator,
                undefined,
                { curPreset: curBank?.preset }
              );
              while (wavetableState.wavetableBanks.some(bank => bank.name === newBank.name)) {
                newBank.name = `${newBank.name}_1`;
              }
              setWavetableState(wavetableState => ({
                ...wavetableState,
                wavetableBanks: Object.freeze([...wavetableState.wavetableBanks, newBank]),
              }));
              setSelectedWavetableName(newBank.name);
            } catch (_err) {
              // cancelled
            }
          },
        },
      ];
    }

    // legacy
    return [
      {
        type: 'select',
        label: 'wavetable',
        options: ['', ...wavetableState.wavetableBanks.map(b => b.name)],
      },
      {
        type: 'button',
        label: 'delete wavetable',
        action: () => {
          const shouldDelete = confirm('Really delete this wavetable?');
          if (!shouldDelete) {
            return;
          }

          // TODO: Check to see if the wavetable is in use by any operators and prevent if so
          setWavetableState(wavetableState => ({
            ...wavetableState,
            wavetableBanks: wavetableState.wavetableBanks.filter(
              bank => bank.name !== state.wavetable
            ),
          }));
        },
      },
      {
        type: 'button',
        label: 'import wavetable',
        action: async () => {
          const LazyUploadWavetableModal = React.lazy(() =>
            import('src/fmSynth/Wavetable/UploadWavetable').then(mod => ({
              default: mod.mkUploadWavetableModal(wavetableState.wavetableBanks.map(b => b.name)),
            }))
          );
          const WrappedUploadWavetableModal: React.FC<UploadWavetableModalProps> = props => (
            <Suspense fallback={<>Loading...</>}>
              <LazyUploadWavetableModal {...props} />
            </Suspense>
          );
          try {
            const wavetableBank = await renderModalWithControls(WrappedUploadWavetableModal);
            console.log('Wavetable bank imported successfully: ', wavetableBank);
            setWavetableState(wavetableState => ({
              ...wavetableState,
              wavetableBanks: [...wavetableState.wavetableBanks, wavetableBank],
            }));
          } catch (_err) {
            // pass
          }
        },
      },
      {
        type: 'button',
        label: 'switch off legacy mode',
        action: () => setUseLegacyControls(false),
      },
    ];
  }, [
    useLegacyControls,
    wavetableState.wavetableBanks,
    selectedWavetableName,
    setWavetableState,
    setSelectedWavetableName,
    state.wavetable,
    setUseLegacyControls,
  ]);
  const handleChange = useCallback(
    (_key: string, wavetableName: string, _state: any) => setSelectedWavetableName(wavetableName),
    [setSelectedWavetableName]
  );

  return <ControlPanel width={500} settings={settings} state={state} onChange={handleChange} />;
};

interface ConfigureWavetableProps {
  config: Extract<OperatorConfig, { type: 'wavetable' }>;
  onChange: (newConfig: OperatorConfig) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  wavetableState: WavetableState;
  setWavetableState: React.Dispatch<React.SetStateAction<WavetableState>>;
  vcId: string | undefined;
  useLegacyControls: boolean;
  setUseLegacyControls: (newVal: boolean) => void;
}

const ConfigureWavetable: React.FC<ConfigureWavetableProps> = ({
  config,
  onChange,
  adsrs,
  onAdsrChange,
  wavetableState,
  setWavetableState,
  vcId,
  useLegacyControls,
  setUseLegacyControls,
}) => (
  <>
    <ConfigureWavetableIndex
      selectedWavetableName={config.wavetableName}
      wavetableState={wavetableState}
      setWavetableState={setWavetableState}
      setSelectedWavetableName={newSelectedWavetableName =>
        onChange({ ...config, wavetableName: newSelectedWavetableName })
      }
      useLegacyControls={useLegacyControls}
      setUseLegacyControls={setUseLegacyControls}
    />
    <ConfigureParamSource
      // title='dim 0 intra mix'
      title='wavetable position'
      state={config.dim0IntraMix}
      onChange={newDim0IntraMix => onChange({ ...config, dim0IntraMix: newDim0IntraMix })}
      min={0}
      max={1}
      step={0.00001}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      vcId={vcId}
    />
    {/* <ConfigureParamSource
      title='dim 1 intra mix'
      state={config.dim1IntraMix}
      onChange={newDim1IntraMix => onChange({ ...config, dim1IntraMix: newDim1IntraMix })}
      min={0}
      max={1}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      vcId={vcId}
    />
    <ConfigureParamSource
      title='inter dim mix'
      state={config.interDimMix}
      onChange={newInterDimMix => onChange({ ...config, interDimMix: newInterDimMix })}
      min={0}
      max={1}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      vcId={vcId}
    /> */}
  </>
);

interface ConfigureOperatorProps {
  config: OperatorConfig;
  onChange: (newConfig: OperatorConfig) => void;
  effects: (Effect | null)[];
  onEffectsChange: (effectIx: number, newEffect: Effect | null) => void;
  setEffects: (newEffects: (Effect | null)[]) => void;
  operatorIx: number;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  wavetableState: WavetableState;
  setWavetableState: React.Dispatch<React.SetStateAction<WavetableState>>;
  vcId: string | undefined;
  sampleMappingStore: Writable<SampleMappingState>;
  registerGateUngateCallbacks: GateUngateCallbackRegistrar;
  useLegacyWavetableControls: boolean;
  setUseLegacyWavetableControls: (newVal: boolean) => void;
}

const OperatorTypeSettings = [
  {
    type: 'select',
    label: 'operator type',
    options: [
      'sine oscillator',
      'square oscillator',
      'triangle oscillator',
      'sawtooth oscillator',
      'exponential oscillator',
      'wavetable',
      'param buffer',
      'sample mapping',
      'white noise',
    ] as OperatorConfig['type'][],
  },
];

const OperatorUnisonSettings = [{ type: 'range', label: 'unison', min: 0, max: 32, step: 1 }];

const ConfigureSampleMapping = mkSvelteComponentShim<{
  store: Writable<SampleMappingState>;
  operatorIx: number;
  registerGateUngateCallbacks: GateUngateCallbackRegistrar;
}>(ConfigureSampleMappingInner as any);

interface ConfigureParamBufferProps {
  config: Extract<OperatorConfig, { type: 'param buffer' }>;
  onChange: (newConfig: OperatorConfig) => void;
}

const ConfigureParamBufferSettings: ControlPanelSetting[] = [
  {
    type: 'select',
    label: 'buffer ix',
    options: new Array(PARAM_BUFFER_COUNT).fill(0).map((_, ix) => ix.toString()),
  },
];

const ConfigureParamBuffer: React.FC<ConfigureParamBufferProps> = ({ config, onChange }) => (
  <ControlPanel
    title='param buffer'
    width={500}
    settings={ConfigureParamBufferSettings}
    state={{ 'buffer ix': config.bufferIx.toString() }}
    onChange={(_key: string, value: string, _state: any) => {
      onChange({ ...config, bufferIx: parseInt(value, 10) });
    }}
  />
);

const UNISON_DETUNE_PHASE_RANDOMIZATION_SETTINGS = [{ type: 'checkbox', label: 'randomize phase' }];

interface ConfigureUnisonDetunePhaseRandomizationProps {
  config: Extract<
    OperatorConfig,
    {
      type:
        | 'sine oscillator'
        | 'square oscillator'
        | 'triangle oscillator'
        | 'sawtooth oscillator'
        | 'wavetable';
    }
  >;
  onChange: (newConfig: OperatorConfig) => void;
}

const ConfigureUnisonDetunePhaseRandomization: React.FC<
  ConfigureUnisonDetunePhaseRandomizationProps
> = ({ config, onChange }) => (
  <ControlPanel
    title='phase randomization'
    width={500}
    settings={UNISON_DETUNE_PHASE_RANDOMIZATION_SETTINGS}
    state={{ 'randomize phase': config.unisonPhaseRandomization.enabled }}
    onChange={(_key: string, _value: any, state: any) => {
      onChange({
        ...config,
        unisonPhaseRandomization: {
          ...config.unisonPhaseRandomization,
          enabled: state['randomize phase'],
        },
      });
    }}
  />
);

const ConfigureOperator: React.FC<ConfigureOperatorProps> = ({
  config,
  onChange,
  effects,
  onEffectsChange,
  setEffects,
  operatorIx,
  adsrs,
  onAdsrChange,
  wavetableState,
  setWavetableState,
  vcId,
  sampleMappingStore,
  registerGateUngateCallbacks,
  useLegacyWavetableControls,
  setUseLegacyWavetableControls,
}) => {
  const operatorTypeState = useMemo(() => ({ 'operator type': config.type }), [config.type]);

  return (
    <div className='operator-config'>
      <ControlPanel
        width={500}
        settings={OperatorTypeSettings}
        title={`configure operator ${operatorIx + 1}`}
        state={operatorTypeState}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'operator type': {
              const newOperator = buildDefaultOperatorConfig(val as OperatorConfig['type']);
              (newOperator as any).frequency =
                (operatorTypeState as any).frequency ?? (config as any).frequency;
              onChange(newOperator);
              break;
            }
            default: {
              console.error('Unhandled key in operator type control panel: ', key);
            }
          }
        }}
      />
      {config.type === 'sine oscillator' ||
      config.type === 'exponential oscillator' ||
      config.type === 'square oscillator' ||
      config.type === 'triangle oscillator' ||
      config.type === 'sawtooth oscillator' ||
      config.type === 'wavetable' ? (
        <ConfigureParamSource
          title='frequency'
          state={config.frequency}
          onChange={newFrequency => onChange({ ...config, frequency: newFrequency })}
          min={0}
          max={20000}
          adsrs={adsrs}
          onAdsrChange={onAdsrChange}
          vcId={vcId}
        />
      ) : null}
      {config.type === 'sine oscillator' ||
      config.type === 'square oscillator' ||
      config.type === 'triangle oscillator' ||
      config.type === 'sawtooth oscillator' ||
      config.type === 'wavetable' ? (
        <>
          <ControlPanel
            width={500}
            settings={OperatorUnisonSettings}
            state={{ unison: config.unison }}
            onChange={(key: string, val: any) => {
              switch (key) {
                case 'unison': {
                  onChange({ ...config, unison: val });
                  break;
                }
                default: {
                  console.error('Unhandled key in operator unison control panel: ', key);
                }
              }
            }}
          />
          {config.unison > 1 ? (
            <>
              <ConfigureParamSource
                title='unison detune'
                state={config.unisonDetune}
                onChange={newUnisonDetune => onChange({ ...config, unisonDetune: newUnisonDetune })}
                min={0.5}
                max={800}
                scale='log'
                adsrs={adsrs}
                onAdsrChange={onAdsrChange}
                vcId={vcId}
              />
              <ConfigureUnisonDetunePhaseRandomization config={config} onChange={onChange} />
            </>
          ) : null}
        </>
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
          vcId={vcId}
        />
      ) : null}
      {config.type === 'wavetable' ? (
        <ConfigureWavetable
          config={config}
          onChange={onChange}
          adsrs={adsrs}
          onAdsrChange={onAdsrChange}
          wavetableState={wavetableState}
          setWavetableState={setWavetableState}
          vcId={vcId}
          useLegacyControls={useLegacyWavetableControls}
          setUseLegacyControls={setUseLegacyWavetableControls}
        />
      ) : null}
      {config.type === 'sample mapping' ? (
        <ConfigureSampleMapping
          store={sampleMappingStore}
          operatorIx={operatorIx}
          registerGateUngateCallbacks={registerGateUngateCallbacks}
        />
      ) : null}
      {config.type === 'param buffer' ? (
        <ConfigureParamBuffer config={config} onChange={onChange} />
      ) : null}
      <ConfigureEffects
        operatorIx={operatorIx}
        state={effects}
        onChange={onEffectsChange}
        setOperatorEffects={setEffects}
        adsrs={adsrs}
        onAdsrChange={onAdsrChange}
        vcId={vcId}
      />
    </div>
  );
};

export default ConfigureOperator;
