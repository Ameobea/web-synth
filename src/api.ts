import { BACKEND_BASE_URL } from 'src/conf';
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

  const res = await fetch(buildURL(`/remote_samples/${descriptor.name}`), {
    method: 'POST',
    body: buf.buffer,
  });
  if (!res.ok) {
    throw await res.text();
  }
  return res.json();
};
