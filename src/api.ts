import type { CompositionDefinition } from 'src/compositionSharing/CompositionSharing';
import { BACKEND_BASE_URL } from 'src/conf';
import type { BuildWavetableInstanceState } from 'src/fmSynth/Wavetable/BuildWavetableInstance';
import type { SerializedMIDIEditorInstance } from 'src/midiEditor';
import { getLoginToken } from 'src/persistance';
import type { Effect } from 'src/redux/modules/effects';
import type { SynthVoicePreset } from 'src/redux/modules/presets';
import type { SerializedLooperInstState } from 'src/redux/modules/looper';
import type { serializeSynthModule } from 'src/redux/modules/synthDesigner';
import type { SampleDescriptor } from 'src/sampleLibrary';
import { getSentry, logError } from 'src/sentry';

const buildURL = (path: string) => `${BACKEND_BASE_URL}${path}`;

/**
 * Performs an authenticated `POST` to the backend, capturing any failure (network error or non-2xx
 * response) to Sentry along with the response body before re-throwing.  The response body now
 * carries a descriptive schema-error message from the backend, so it's worth recording.
 *
 * Returns the `Response` on success so callers can read the body if they need it.
 */
const apiPost = async (
  path: string,
  body: unknown,
  opts?: { headers?: Record<string, string> }
): Promise<Response> => {
  const maybeLoginToken = await getLoginToken();

  let res: Response;
  try {
    res = await fetch(buildURL(path), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: maybeLoginToken, ...opts?.headers },
    });
  } catch (err) {
    logError(`Network error during POST ${path}`, err);
    throw err;
  }

  if (!res.ok) {
    const responseText = await res.text().catch(() => '<failed to read response body>');
    const err = new Error(`POST ${path} failed with status ${res.status}`);
    getSentry()?.captureException(err, { extra: { path, status: res.status, responseText } });
    throw err;
  }

  return res;
};

export const saveSynthVoicePreset = async (preset: {
  title: string;
  description: string;
  body: ReturnType<typeof serializeSynthModule>;
}) => {
  await apiPost('/synth_voice_presets', preset);
};

export const saveSynthPreset = async (preset: {
  title: string;
  description: string;
  body: {
    voices: ReturnType<typeof serializeSynthModule>[];
  };
}) => {
  await apiPost('/synth_presets', preset);
};

export const getSynthVoicePreset = async (id: number): Promise<SynthVoicePreset> =>
  fetch(`${BACKEND_BASE_URL}/synth_voice_preset/${id}`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getSynthPreset = async (id: number): Promise<{ voices: SynthVoicePreset[] }> =>
  fetch(`${BACKEND_BASE_URL}/synth_preset/${id}`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

const parseCompositionDefinition = (composition: CompositionDefinition): CompositionDefinition => {
  if (typeof composition.createdAt === 'string') {
    composition.createdAt = new Date(`${composition.createdAt}Z`);
  }
  if (composition.versions) {
    for (const version of composition.versions) {
      if (typeof version.createdAt === 'string') {
        version.createdAt = new Date(`${version.createdAt}Z`);
      }
    }
  }
  return composition;
};

export const fetchAllSharedCompositions = (): Promise<Omit<CompositionDefinition, 'content'>[]> =>
  fetch(`${BACKEND_BASE_URL}/compositions`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return ((await res.json()) as CompositionDefinition[]).map(parseCompositionDefinition);
  });

export const getExistingCompositionTags = async (): Promise<{ name: string; count: number }[]> =>
  fetch(`${BACKEND_BASE_URL}/composition_tags`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getLoadedComposition = async (compositionID: string | number) => {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/compositions/${compositionID}`);
    if (res.status === 404) {
      getSentry()?.captureMessage("Tried to load composition that wasn't found", {
        extra: { compositionID },
      });
      toastError(`Composition with id "${compositionID}" not found`);
      return;
    } else if (!res.ok) {
      getSentry()?.captureMessage('Error loading composition', { extra: { compositionID } });
      toastError(`Error loading composition: ${await res.text()}`);
      return;
    }

    return parseCompositionDefinition(await res.json());
  } catch (err) {
    logError('Error fetching composition', err);
    toastError(`Error fetching composition: ${err}`);
    throw err;
  }
};

export const saveComposition = async (
  title: string,
  description: string,
  serializedComposition: { [key: string]: string },
  tags: string[],
  parentID?: number | null
): Promise<number> =>
  fetch(`${BACKEND_BASE_URL}/compositions`, {
    method: 'POST',
    body: JSON.stringify({ title, description, content: serializedComposition, tags, parentID }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: await getLoginToken(),
    },
  }).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export interface RemoteSample {
  id: string;
  name: string;
  sampleUrl: string;
}

export const storeRemoteSample = async (
  descriptor: SampleDescriptor,
  data: AudioBuffer
): Promise<RemoteSample> => {
  const buf = new Float32Array(data.length);
  data.copyFromChannel(buf, 0);

  const res = await fetch(buildURL(`/remote_samples?name=${descriptor.name}`), {
    method: 'POST',
    body: buf.buffer,
  });
  if (!res.ok) {
    throw await res.text();
  }
  return res.json();
};

export const listRemoteSamples = async (): Promise<RemoteSample[]> =>
  fetch(buildURL('/remote_samples'), { headers: { Authorization: await getLoginToken() } }).then(
    async res => {
      if (!res.ok) {
        throw await res.text();
      }
      return res.json();
    }
  );

export type EffectDescriptor = Omit<Effect, 'code'>;

export const fetchEffects = (): Promise<EffectDescriptor[]> =>
  fetch(`${BACKEND_BASE_URL}/effects`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getEffect = async (id: number): Promise<Effect> =>
  fetch(`${BACKEND_BASE_URL}/effect/${id}`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const saveEffect = async (effect: Omit<Effect, 'id'>) => {
  const maybeLoginToken = await getLoginToken();
  return fetch(`${BACKEND_BASE_URL}/effects`, {
    method: 'POST',
    body: JSON.stringify(effect),
    headers: {
      Authorization: maybeLoginToken,
    },
  }).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
  });
};

export interface SavedMIDICompositionDescriptor {
  id: number;
  name: string;
  description: string;
  tags: string[];
  userId: number | null | undefined;
  userName: string | null | undefined;
  createdAt?: Date | null;
  isFeatured?: boolean;
}

/**
 * A descriptor along with its fetched composition body.  The looper persists this full object inline
 * in its own serialized state, so it needs both the metadata and the composition notes.
 */
export interface SavedMIDIComposition extends SavedMIDICompositionDescriptor {
  composition: SerializedMIDIEditorInstance;
}

const parseSavedMIDIComposition = (
  composition: SavedMIDICompositionDescriptor
): SavedMIDICompositionDescriptor => {
  if (typeof composition.createdAt === 'string') {
    composition.createdAt = new Date(`${composition.createdAt}Z`);
  }
  return composition;
};

export const getSavedMIDICompositions = async (): Promise<SavedMIDICompositionDescriptor[]> =>
  fetch(`${BACKEND_BASE_URL}/midi_compositions`).then(async res =>
    ((await res.json()) as SavedMIDICompositionDescriptor[]).map(parseSavedMIDIComposition)
  );

export const getMIDIComposition = async (
  id: number
): Promise<SerializedMIDIEditorInstance | null> =>
  fetch(`${BACKEND_BASE_URL}/midi_composition/${id}`).then(async res => {
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const saveMIDIComposition = async (
  name: string,
  description: string,
  composition: SerializedMIDIEditorInstance,
  tags: string[]
) => {
  const maybeLoginToken = await getLoginToken();
  return fetch(`${BACKEND_BASE_URL}/midi_compositions`, {
    body: JSON.stringify({ name, description, composition, tags }),
    method: 'POST',
    headers: {
      Authorization: maybeLoginToken,
    },
  });
};

interface MIDICompositionTag {
  name: string;
  count: number;
}

export const getExistingMIDICompositionTags = async (): Promise<MIDICompositionTag[]> =>
  fetch(`${BACKEND_BASE_URL}/midi_composition_tags`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export interface GenericPresetDescriptor {
  id: number;
  name: string;
  description: string;
  tags: string[];
  userId: number | null | undefined;
  userName: string | null | undefined;
  isFeatured?: boolean;
}

export const fetchLooperPresets = async (): Promise<GenericPresetDescriptor[]> =>
  fetch(`${BACKEND_BASE_URL}/looper_presets`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const saveLooperPreset = async (preset: {
  name: string;
  description: string;
  tags: string[];
  preset: SerializedLooperInstState;
}) => apiPost('/looper_preset', preset).then(res => res.json());

export const getExistingLooperPresetTags = async (): Promise<{ name: string; count: number }[]> =>
  fetch(`${BACKEND_BASE_URL}/looper_preset_tags`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getLooperPreset = async (id: number): Promise<SerializedLooperInstState> =>
  fetch(`${BACKEND_BASE_URL}/looper_preset/${id}`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export type SubgraphPreset = { [key: string]: any }; // opaque; handled in engine

export const saveSubgraphPreset = async (preset: {
  name: string;
  description: string;
  tags: string[];
  preset: SubgraphPreset;
}) => apiPost('/subgraph_preset', preset).then(res => res.json());

export const fetchSubgraphPresets = async (): Promise<GenericPresetDescriptor[]> =>
  fetch(`${BACKEND_BASE_URL}/subgraph_presets`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getExistingSubgraphPresetTags = async (): Promise<{ name: string; count: number }[]> =>
  fetch(`${BACKEND_BASE_URL}/subgraph_preset_tags`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getSubgraphPreset = async (id: number | string): Promise<SubgraphPreset> =>
  fetch(`${BACKEND_BASE_URL}/subgraph_preset/${id}`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export interface WavetablePreset {
  waveforms: {
    instState: BuildWavetableInstanceState;
    renderedWaveformSamplesBase64: string;
  }[];
  /**
   * JavaScript source code used to produce the wavetable
   */
  sourceCode?: string;
}

export interface WavetablePresetDescriptor {
  id: number;
  name: string;
  description: string;
  tags: string[];
  userId: number | null | undefined;
  userName: string | null | undefined;
  isFeatured?: boolean;
}

export interface SaveWaveformPresetRequest {
  name: string;
  description: string;
  tags: string[];
  serializedWavetableInstState: WavetablePreset;
}

export const fetchWavetablePresets = async (): Promise<WavetablePresetDescriptor[]> =>
  fetch(`${BACKEND_BASE_URL}/wavetable_presets`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const saveWavetablePreset = async (preset: SaveWaveformPresetRequest) =>
  apiPost('/wavetable_preset', preset).then(res => res.json());

export const getWavetablePreset = async (id: number): Promise<WavetablePreset> =>
  fetch(`${BACKEND_BASE_URL}/wavetable_preset/${id}`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getExistingWavetablePresetTags = async (): Promise<
  { name: string; count: number }[]
> =>
  fetch(`${BACKEND_BASE_URL}/wavetable_preset_tags`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const login = async (username: string, password: string) => {
  const res = await fetch(`${BACKEND_BASE_URL}/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw await res.text();
  }

  return res.text();
};

export const register = async (username: string, password: string) => {
  const res = await fetch(`${BACKEND_BASE_URL}/register`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw await res.text();
  }

  return res.text();
};

export const getLoggedInUsername = async (): Promise<string | null> => {
  const loginToken = await getLoginToken();
  if (!loginToken) {
    return null;
  }

  const res = await fetch(`${BACKEND_BASE_URL}/logged_in_username`, {
    headers: { Authorization: loginToken },
  });
  if (!res.ok) {
    return null;
  }
  return res.text();
};
