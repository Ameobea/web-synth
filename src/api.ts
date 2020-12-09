import { Without } from 'ameo-utils';
import { CompositionDefinition } from 'src/compositionSharing/CompositionSharing';
import { BACKEND_BASE_URL } from 'src/conf';
import { Effect } from 'src/redux/modules/effects';
import { serializeSynthModule } from 'src/redux/modules/synthDesigner';
import { SampleDescriptor } from 'src/sampleLibrary';

const buildURL = (path: string) => `${BACKEND_BASE_URL}${path}`;

export const saveSynthVoicePreset = (preset: {
  title: string;
  description: string;
  body: ReturnType<typeof serializeSynthModule>;
}) =>
  fetch(buildURL('/synth_voice_presets'), {
    method: 'POST',
    body: JSON.stringify(preset),
  }).then(res => {
    if (!res.ok) {
      throw new Error(`Got bad status code ${res.status} when performing API request`);
    }
  });

export const saveSynthPreset = (preset: {
  title: string;
  description: string;
  body: {
    voices: (ReturnType<typeof serializeSynthModule> & { type: 'wavetable' | 'standard' })[];
  };
}) =>
  fetch(buildURL('/synth_presets'), {
    method: 'POST',
    body: JSON.stringify(preset),
  }).then(res => {
    if (!res.ok) {
      throw new Error(`Got bad status code ${res.status} when performing API request`);
    }
  });

export const fetchAllSharedCompositions = (): Promise<CompositionDefinition[]> =>
  fetch(`${BACKEND_BASE_URL}/compositions`).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const saveComposition = async (
  title: string,
  description: string,
  serializedComposition: { [key: string]: string }
) =>
  fetch(`${BACKEND_BASE_URL}/compositions`, {
    method: 'POST',
    body: JSON.stringify({ title, description, user: 0, content: serializedComposition }),
    headers: {
      'Content-Type': 'application/json',
    },
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
  fetch(buildURL('/remote_samples')).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
    return res.json();
  });

export const saveEffect = (effect: Without<Effect, 'id'>) =>
  fetch(`${BACKEND_BASE_URL}/effects`, {
    method: 'POST',
    body: JSON.stringify(effect),
  }).then(async res => {
    if (!res.ok) {
      throw await res.text();
    }
  });
(window as any).saveEffect = saveEffect;
