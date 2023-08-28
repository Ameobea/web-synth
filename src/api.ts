import type { Without } from 'ameo-utils';

import type { CompositionDefinition } from 'src/compositionSharing/CompositionSharing';
import { BACKEND_BASE_URL } from 'src/conf';
import type { BuildWavetableInstanceState } from 'src/fmSynth/Wavetable/BuildWavetableInstance';
import { SerializedMIDIEditorInstance } from 'src/midiEditor';
import { getLoginToken } from 'src/persistance';
import type { Effect } from 'src/redux/modules/effects';
import type { SerializedLooperInstState } from 'src/redux/modules/looper';
import type { serializeSynthModule } from 'src/redux/modules/synthDesigner';
import type { SampleDescriptor } from 'src/sampleLibrary';

const buildURL = (path: string) => `${BACKEND_BASE_URL}${path}`;

export const saveSynthVoicePreset = async (preset: {
  title: string;
  description: string;
  body: ReturnType<typeof serializeSynthModule>;
}) => {
  const maybeLoginToken = await getLoginToken();
  return fetch(buildURL('/synth_voice_presets'), {
    method: 'POST',
    body: JSON.stringify(preset),
    headers: {
      Authorization: maybeLoginToken,
    },
  }).then(res => {
    if (!res.ok) {
      throw new Error(`Got bad status code ${res.status} when performing API request`);
    }
  });
};

export const saveSynthPreset = async (preset: {
  title: string;
  description: string;
  body: {
    voices: ReturnType<typeof serializeSynthModule>[];
  };
}) => {
  const maybeLoginToken = await getLoginToken();
  fetch(buildURL('/synth_presets'), {
    method: 'POST',
    body: JSON.stringify(preset),
    headers: {
      Authorization: maybeLoginToken,
    },
  }).then(res => {
    if (!res.ok) {
      throw new Error(`Got bad status code ${res.status} when performing API request`);
    }
  });
};

export const fetchAllSharedCompositions = (): Promise<Omit<CompositionDefinition, 'content'>[]> =>
  fetch(`${BACKEND_BASE_URL}/compositions`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getExistingCompositionTags = async (): Promise<{ name: string; count: number }[]> =>
  fetch(`${BACKEND_BASE_URL}/composition_tags`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const getLoadedComposition = async (compositionID: string | number) => {
  const res = await fetch(`${BACKEND_BASE_URL}/compositions/${compositionID}`);
  if (res.status === 404) {
    alert(`Composition with id "${compositionID}" not found`);
    return;
  } else if (!res.ok) {
    alert(`Error loading composition: ${await res.text()}`);
    return;
  }
  const composition: CompositionDefinition = await res.json();
  return composition;
};

export const saveComposition = async (
  title: string,
  description: string,
  serializedComposition: { [key: string]: string },
  tags: string[]
): Promise<number> =>
  fetch(`${BACKEND_BASE_URL}/compositions`, {
    method: 'POST',
    body: JSON.stringify({ title, description, content: serializedComposition, tags }),
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

export const fetchEffects = (): Promise<Effect[]> =>
  fetch(`${BACKEND_BASE_URL}/effects`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const saveEffect = async (effect: Without<Effect, 'id'>) => {
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

export interface SavedMIDIComposition {
  id: number;
  name: string;
  description: string;
  composition: SerializedMIDIEditorInstance;
  tags: string[];
  userId: number | null | undefined;
  userName: string | null | undefined;
}

export const getSavedMIDICompositions = async (): Promise<SavedMIDIComposition[]> =>
  fetch(`${BACKEND_BASE_URL}/midi_compositions`).then(res => res.json());

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

export const getExistingMIDICompositionTags = async (): Promise<
  { name: string; count: number }[]
> =>
  fetch(`${BACKEND_BASE_URL}/midi_composition_tags`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export interface LooperPreset {
  id: number;
  name: string;
  description: string;
  tags: string[];
  userId: number | null | undefined;
  userName: string | null | undefined;
}

export const fetchLooperPresets = async (): Promise<LooperPreset[]> =>
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
  serializedLooperInstState: SerializedLooperInstState;
}) => {
  const maybeLoginToken = await getLoginToken();
  return fetch(`${BACKEND_BASE_URL}/looper_preset`, {
    body: JSON.stringify(preset),
    method: 'POST',
    headers: {
      Authorization: maybeLoginToken,
    },
  }).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });
};

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

export interface WavetablePreset {
  waveforms: {
    instState: BuildWavetableInstanceState;
    renderedWaveformSamplesBase64: string;
  }[];
}

export interface WavetablePresetDescriptor {
  id: number;
  name: string;
  description: string;
  tags: string[];
  userId: number | null | undefined;
  userName: string | null | undefined;
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

export const saveWavetablePreset = async (preset: SaveWaveformPresetRequest) => {
  const maybeLoginToken = await getLoginToken();
  return fetch(`${BACKEND_BASE_URL}/wavetable_preset`, {
    body: JSON.stringify(preset),
    method: 'POST',
    headers: {
      Authorization: maybeLoginToken,
    },
  }).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });
};

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
