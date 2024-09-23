import { buildActionGroup, buildModule } from 'jantix';

import { BACKEND_BASE_URL } from 'src/conf';
import type { ADSRValues } from 'src/controls/adsr';
import { actionCreators, dispatch } from 'src/redux';
import type { serializeSynthModule } from 'src/redux/modules/synthDesigner';
import { retryAsync } from 'src/util';

export interface SynthPresetEntry {
  id: number;
  title: string;
  description: string;
  body: { voices: SynthVoicePreset[] };
  userId: number | null | undefined;
}

export type SynthVoicePreset = ReturnType<typeof serializeSynthModule> & {
  gainEnvelope?: ADSRValues;
  gainADSRLength?: number;
};

export interface SynthVoicePresetEntry {
  id: number;
  title: string;
  description: string;
  body: SynthVoicePreset;
  userId: number | null | undefined;
}

export type PresetsState = {
  synthPresets: 'NOT_FETCHED' | 'FETCHING' | 'FETCH_ERROR' | SynthPresetEntry[];
  voicePresets: 'NOT_FETCHED' | 'FETCHING' | 'FETCH_ERROR' | SynthVoicePresetEntry[];
};

const buildInitialState = (): PresetsState => ({
  synthPresets: 'NOT_FETCHED',
  voicePresets: 'NOT_FETCHED',
});

const actionGroups = {
  SET_SYNTH_PRESETS: buildActionGroup({
    actionCreator: (presets: PresetsState['synthPresets']) => ({
      type: 'SET_SYNTH_PRESETS',
      presets,
    }),
    subReducer: (state: PresetsState, { presets }) => ({ ...state, synthPresets: presets }),
  }),
  SET_SYNTH_VOICE_PRESETS: buildActionGroup({
    actionCreator: (presets: PresetsState['voicePresets']) => ({
      type: 'SET_SYNTH_VOICE_PRESETS',
      presets,
    }),
    subReducer: (state: PresetsState, { presets }) => ({ ...state, voicePresets: presets }),
  }),
};

export default buildModule<PresetsState, typeof actionGroups>(buildInitialState(), actionGroups);

export const fetchSynthPresets = async () => {
  dispatch(actionCreators.presets.SET_SYNTH_PRESETS('FETCHING'));

  try {
    const presets = await retryAsync(
      () => fetch(`${BACKEND_BASE_URL}/synth_presets`).then(res => res.json()),
      3
    );
    dispatch(actionCreators.presets.SET_SYNTH_PRESETS(presets));
  } catch (err) {
    console.error(`Error fetching synth presets: ${err}`);
    dispatch(actionCreators.presets.SET_SYNTH_PRESETS('FETCH_ERROR'));
  }
};

export const fetchSynthVoicePresets = async () => {
  dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS('FETCHING'));
  try {
    const presets: SynthVoicePresetEntry[] = await retryAsync(
      () => fetch(`${BACKEND_BASE_URL}/synth_voice_presets`).then(res => res.json()),
      3
    );
    dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS(presets));
  } catch (err) {
    console.error(`Error fetching synth voice presets: ${err}`);
    dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS('FETCH_ERROR'));
  }
};
