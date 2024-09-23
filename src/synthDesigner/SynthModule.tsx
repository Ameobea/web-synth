import React, { useCallback, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { Provider, shallowEqual, useSelector } from 'react-redux';

import { saveSynthVoicePreset } from 'src/api';
import {
  mkControlPanelADSR2WithSize,
  type ADSRWithOutputRange,
} from 'src/controls/adsr2/ControlPanelADSR2';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { ConnectedFMSynthUI } from 'src/fmSynth/FMSynthUI';
import type { Adsr, AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { updateConnectables } from 'src/patchNetwork/interface';
import { store, type ReduxStore } from 'src/redux';
import { getSynthDesignerReduxInfra, type SynthModule } from 'src/redux/modules/synthDesigner';
import { get_synth_designer_audio_connectables, getVoicePreset } from 'src/synthDesigner';
import { UnreachableError, msToSamples, samplesToMs } from 'src/util';
import { Filter as FilterModule } from './Filter';
import {
  mkGenericPresetPicker,
  type PresetDescriptor,
} from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { renderModalWithControls } from 'src/controls/Modal';
import { type SynthVoicePreset } from 'src/redux/modules/presets';
import { VoicePresetFetchError } from 'src/synthDesigner/VoicePresetFetchError';

const PRESETS_CONTROL_PANEL_STYLE = { height: 97, width: 400 };

interface PresetsControlPanelProps {
  index: number;
  stateKey: string;
}

const PresetsControlPanel: React.FC<PresetsControlPanelProps> = ({ index, stateKey }) => {
  const { dispatch, actionCreators } = getSynthDesignerReduxInfra(stateKey);
  const allVoicePresetsRaw = useSelector(
    (state: ReduxStore) => state.presets.voicePresets,
    shallowEqual
  );
  const allVoicePresets = useMemo(
    () =>
      typeof allVoicePresetsRaw === 'string'
        ? allVoicePresetsRaw
        : allVoicePresetsRaw.map(
            (preset): PresetDescriptor<SynthVoicePreset> => ({
              ...preset,
              name: preset.title,
              preset: preset.body,
            })
          ),
    [allVoicePresetsRaw]
  );

  const settings = useMemo(() => {
    if (typeof allVoicePresets === 'string') {
      return null;
    }

    return [
      {
        label: 'load preset',
        type: 'button',
        action: async () => {
          let pickedPreset: PresetDescriptor<SynthVoicePreset>;
          try {
            pickedPreset = await renderModalWithControls(
              mkGenericPresetPicker(() => allVoicePresets)
            );
          } catch (_err) {
            return; // cancelled
          }

          dispatch(actionCreators.synthDesigner.SET_VOICE_STATE(index, pickedPreset.preset));
        },
      },
      {
        label: 'save preset',
        type: 'button',
        action: async () => {
          const { name: title, description } = await renderGenericPresetSaverWithModal({
            description: true,
          });
          const presetBody = getVoicePreset(stateKey, index);
          try {
            await saveSynthVoicePreset({ title, description: description ?? '', body: presetBody });
          } catch (_err) {
            // cancelled
          }
        },
      },
    ];
  }, [actionCreators.synthDesigner, allVoicePresets, dispatch, index, stateKey]);

  if (settings) {
    return <ControlPanel proxy style={PRESETS_CONTROL_PANEL_STYLE} settings={settings} />;
  } else if (allVoicePresets === 'FETCH_ERROR') {
    return <VoicePresetFetchError />;
  } else {
    return <span className='presets-loading'>Loading...</span>;
  }
};

interface SynthControlPanelProps extends Pick<SynthModule, 'masterGain' | 'pitchMultiplier'> {
  stateKey: string;
  index: number;
  gainEnvelope: AdsrParams;
  gainADSRLength: number;
}

const buildSynthControlPanelSettings = (vcId: string) => [
  {
    type: 'range',
    label: 'volume',
    min: -1,
    max: 1,
    step: 0.008,
  },
  {
    type: 'text',
    label: 'pitch multiplier',
  },
  {
    type: 'range',
    label: 'adsr length ms',
    min: 50,
    max: 10000,
  },
  {
    type: 'checkbox',
    label: 'log scale',
  },
  {
    type: 'custom',
    label: 'gain envelope',
    Comp: mkControlPanelADSR2WithSize(380, 200, vcId, 'synthDesignerGainEnvelope'),
  },
];

const SynthControlPanelInner: React.FC<SynthControlPanelProps> = props => {
  const [localPitchMultiplier, setLocalPitchMultiplier] = useState<string | null>(null);
  const { dispatch, actionCreators, getState } = getSynthDesignerReduxInfra(props.stateKey);
  const [gainADSRLengthMs, setGainADSRLengthMs] = useState<number>(props.gainADSRLength);
  const [gainEnvelope, setGainEnvelope] = useState<Adsr>({
    ...props.gainEnvelope,
    lenSamples: msToSamples(gainADSRLengthMs),
  });

  const handleSynthChange = useCallback(
    (key: string, val: any) => {
      switch (key) {
        case 'volume': {
          dispatch(actionCreators.synthDesigner.SET_SYNTH_MASTER_GAIN(props.index, val));
          return;
        }
        case 'gain envelope': {
          setGainEnvelope(val);
          const fmSynth = getState().synthDesigner.synths[props.index].fmSynth;
          fmSynth.handleAdsrChange(-1, {
            ...val,
            lenSamples: { type: 'constant', value: msToSamples(gainADSRLengthMs) },
          });
          return;
        }
        case 'adsr length ms': {
          setGainADSRLengthMs(val);
          const fmSynth = getState().synthDesigner.synths[props.index].fmSynth;
          fmSynth.handleAdsrChange(-1, {
            ...fmSynth.gainEnvelope,
            lenSamples: { type: 'constant', value: msToSamples(val) },
          });
          setGainEnvelope({ ...gainEnvelope, lenSamples: val });
          return;
        }
        case 'log scale': {
          const fmSynth = getState().synthDesigner.synths[props.index].fmSynth;
          fmSynth.handleAdsrChange(-1, {
            ...fmSynth.gainEnvelope,
            logScale: val,
          });
          setGainEnvelope({ ...gainEnvelope, logScale: val });
          return;
        }
        case 'pitch multiplier': {
          setLocalPitchMultiplier(val);
          const value = Number.parseFloat(val);
          if (Number.isNaN(value)) {
            return;
          }
          dispatch(actionCreators.synthDesigner.SET_PITCH_MULTIPLIER(props.index, value));
          return;
        }
        default: {
          console.warn('Unhandled key in synth control panel: ', key);
        }
      }
    },
    [actionCreators.synthDesigner, dispatch, gainADSRLengthMs, gainEnvelope, getState, props.index]
  );

  const state = useMemo(() => {
    const gainEnvelopeState: ADSRWithOutputRange = {
      ...gainEnvelope,
      lenSamples: msToSamples(gainADSRLengthMs),
      outputRange: [0, 1],
    };

    return {
      volume: props.masterGain,
      'adsr length ms': gainADSRLengthMs,
      'gain envelope': gainEnvelopeState,
      'pitch multiplier': localPitchMultiplier ?? props.pitchMultiplier?.toString() ?? 1,
      'log scale': gainEnvelope.logScale,
    };
  }, [
    props.masterGain,
    gainADSRLengthMs,
    gainEnvelope,
    props.pitchMultiplier,
    localPitchMultiplier,
  ]);
  const vcId = props.stateKey.split('_')[1];
  const settings = useMemo(() => buildSynthControlPanelSettings(vcId), [vcId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'rgb(35, 35, 35)' }}>
      <ControlPanel
        title='SYNTH'
        settings={settings}
        onChange={handleSynthChange}
        state={state}
        width={400}
      />
      <PresetsControlPanel index={props.index} stateKey={props.stateKey} />
    </div>
  );
};
const SynthControlPanel = React.memo(SynthControlPanelInner);

interface SynthModuleCompProps {
  index: number;
  synth: SynthModule;
  stateKey: string;
  isHidden: boolean;
  vcId: string;
  deleteDisabled: boolean;
  children?: React.ReactNode;
}

const SynthModuleCompInner: React.FC<SynthModuleCompProps> = ({
  index,
  synth,
  stateKey,
  children = null,
  isHidden,
  vcId,
  deleteDisabled,
}) => {
  const { dispatch, actionCreators } = getSynthDesignerReduxInfra(stateKey);
  const filterEnvelope = useMemo(
    (): ADSRWithOutputRange => ({ ...synth.filterEnvelope, outputRange: [20, 20_000] as const }),
    [synth.filterEnvelope]
  );
  const getFMSynthOutput = useCallback(async () => {
    const output = get_synth_designer_audio_connectables(stateKey).outputs.get('masterOutput');
    if (!output || output.type !== 'customAudio') {
      throw new UnreachableError('Missing `masterGain` on synth designer audio connectables');
    }
    return output.node as AudioNode;
  }, [stateKey]);

  return (
    <div className='synth-module'>
      <div
        role='button'
        tabIndex={0}
        aria-disabled={deleteDisabled}
        className='synth-remove-button'
        style={deleteDisabled ? { color: 'rgb(94, 94, 94)' } : undefined}
        onClick={() => {
          if (deleteDisabled) {
            return;
          }

          dispatch(actionCreators.synthDesigner.DELETE_SYNTH_MODULE(index));
          const vcId = stateKey.split('_')[1]!;
          const newConnectables = get_synth_designer_audio_connectables(stateKey);
          updateConnectables(vcId, newConnectables);
        }}
      >
        ×
      </div>

      <SynthControlPanel
        masterGain={synth.masterGain}
        pitchMultiplier={synth.pitchMultiplier}
        stateKey={stateKey}
        index={index}
        gainEnvelope={synth.fmSynth.gainEnvelope}
        gainADSRLength={samplesToMs(synth.fmSynth.gainEnvelope.lenSamples.value)}
      />

      <ConnectedFMSynthUI
        synth={synth.fmSynth}
        synthID={`${stateKey}_${index}`}
        getFMSynthOutput={getFMSynthOutput}
        isHidden={isHidden}
        vcId={vcId}
      />

      <FilterModule
        synthIx={index}
        params={synth.filterParams}
        filterEnvelope={filterEnvelope}
        stateKey={stateKey}
        bypass={synth.filterBypassed}
        adsrLength={synth.filterADSRLength}
        enableEnvelope={synth.filterEnvelopeEnabled ?? false}
      />

      <div className='effects'>{children}</div>
    </div>
  );
};

const SynthModuleComp: React.FC<SynthModuleCompProps> = ({ ...props }) => (
  <Provider store={store}>
    <SynthModuleCompInner {...props} />
  </Provider>
);

export default React.memo(SynthModuleComp);
