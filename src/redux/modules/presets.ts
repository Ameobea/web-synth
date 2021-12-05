import { buildActionGroup, buildModule } from 'jantix';
import { createSelector } from 'reselect';

import { BACKEND_BASE_URL } from 'src/conf';
import type { ADSRValues } from 'src/controls/adsr';
import { dispatch, actionCreators, ReduxStore } from 'src/redux';
import { serializeSynthModule } from 'src/redux/modules/synthDesigner';

export interface SynthPresetEntry {
  id: number;
  title: string;
  description: string;
  body: { voices: SynthVoicePreset[] };
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
}

export type PresetsState = {
  synthPresets: 'NOT_FETCHED' | 'FETCHING' | SynthPresetEntry[];
  voicePresets: 'NOT_FETCHED' | 'FETCHING' | SynthVoicePresetEntry[];
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

const fetchWithRetries = async <T>(
  attemptCount: number,
  fetcher: () => Promise<T>,
  attemptFailMsg?: string,
  batchFailMsg?: string
): Promise<T> => {
  for (let i = 0; i < attemptCount; i++) {
    try {
      return fetcher();
    } catch (err) {
      console.warn(attemptFailMsg || `Failed to fetch; attempts: ${i + 1}`);
    }
  }
  throw new Error(batchFailMsg || `Failed to fetch after ${attemptCount} attempts`);
};

export const fetchSynthPresets = async () => {
  dispatch(actionCreators.presets.SET_SYNTH_PRESETS('FETCHING'));
  const presets: SynthPresetEntry[] = await fetchWithRetries(3, () =>
    fetch(`${BACKEND_BASE_URL}/synth_presets`).then(res => res.json())
  );
  dispatch(actionCreators.presets.SET_SYNTH_PRESETS(presets));
};

export const fetchSynthVoicePresets = async () => {
  dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS('FETCHING'));
  const presets: SynthVoicePresetEntry[] = await fetchWithRetries(3, () =>
    fetch(`${BACKEND_BASE_URL}/synth_voice_presets`).then(res => res.json())
  );
  dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS(presets));
};

export const voicePresetIdsSelector = createSelector(
  (state: ReduxStore) => state.presets.voicePresets,
  (voicePresets): { [title: string]: number } =>
    typeof voicePresets === 'string'
      ? {}
      : voicePresets.reduce((acc, { id, title }) => ({ ...acc, [title]: id }), {})
);
