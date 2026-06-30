import { buildActionGroup, buildModule } from 'jantix';

import { BACKEND_BASE_URL } from 'src/conf';
import type { ADSRValues } from 'src/controls/adsr';
import { actionCreators, dispatch } from 'src/redux';
import type { serializeSynthModule } from 'src/redux/modules/synthDesigner';
import { retryAsync } from 'src/util';

export type SynthVoicePreset = ReturnType<typeof serializeSynthModule> & {
  gainEnvelope?: ADSRValues;
  gainADSRLength?: number;
};

/**
 * Metadata-only descriptor returned by the `synth_presets` listing endpoint.  The actual preset
 * body (`{ voices }`) is fetched lazily by id via `getSynthPreset` when a preset is selected.
 */
export interface SynthPresetDescriptor {
  id: number;
  title: string;
  description: string;
  userId: number | null | undefined;
  isFeatured?: boolean;
}

/**
 * Metadata-only descriptor returned by the `synth_voice_presets` listing endpoint.  The voice body
 * is fetched lazily by id via `getSynthVoicePreset` when a preset is selected.
 */
export interface SynthVoicePresetDescriptor {
  id: number;
  title: string;
  description: string;
  userId: number | null | undefined;
  isFeatured?: boolean;
}

export type PresetsState = {
  synthPresets: 'NOT_FETCHED' | 'FETCHING' | 'FETCH_ERROR' | SynthPresetDescriptor[];
  voicePresets: 'NOT_FETCHED' | 'FETCHING' | 'FETCH_ERROR' | SynthVoicePresetDescriptor[];
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
    const presets: SynthVoicePresetDescriptor[] = await retryAsync(
      () => fetch(`${BACKEND_BASE_URL}/synth_voice_presets`).then(res => res.json()),
      3
    );
    dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS(presets));
  } catch (err) {
    console.error(`Error fetching synth voice presets: ${err}`);
    dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS('FETCH_ERROR'));
  }
};

/**
 * Eagerly populates the synth + voice preset *descriptor* lists used by the synth designer's preset
 * pickers.  Called explicitly from the non-headless entry point rather than as a module side effect
 * so it never races the `window.isHeadless` flag (which isn't yet set when this module is first
 * evaluated in the headless bundle).
 */
export const prefetchSynthPresets = () => {
  fetchSynthPresets();
  fetchSynthVoicePresets();
};
