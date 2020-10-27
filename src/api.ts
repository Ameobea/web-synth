import { BACKEND_BASE_URL } from 'src/conf';
import { serializeSynthModule } from 'src/redux/modules/synthDesigner';

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
  body: ReturnType<typeof serializeSynthModule>[];
}) =>
  fetch(buildURL('/synth_presets'), {
    method: 'POST',
    body: JSON.stringify({ ...preset, body: { voices: preset.body } }),
  }).then(res => {
    if (!res.ok) {
      throw new Error(`Got bad status code ${res.status} when performing API request`);
    }
  });
