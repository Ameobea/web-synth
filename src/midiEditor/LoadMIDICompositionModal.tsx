import { getSavedMIDICompositions } from 'src/api';
import { pickPresetWithModal } from 'src/controls/GenericPresetPicker/GenericPresetPicker';

const wrappedGetSavedMIDICompositions = () =>
  getSavedMIDICompositions().then(compositions =>
    compositions.map(comp => ({
      ...comp,
      name: comp.name,
      description: comp.description,
      tags: comp.tags,
      preset: comp,
    }))
  );

export const mkLoadMIDICompositionModal = () =>
  pickPresetWithModal(wrappedGetSavedMIDICompositions);
