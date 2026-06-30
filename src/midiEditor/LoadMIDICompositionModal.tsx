import { getSavedMIDICompositions } from 'src/api';
import { pickPresetWithModal } from 'src/controls/GenericPresetPicker/GenericPresetPicker';

const wrappedGetSavedMIDICompositions = () =>
  getSavedMIDICompositions().then(compositions =>
    compositions.map(comp => ({
      id: comp.id,
      name: comp.name,
      description: comp.description,
      tags: comp.tags,
      preset: comp,
      userID: comp.userId,
      userName: comp.userName,
      isFeatured: comp.isFeatured,
    }))
  );

/**
 * Presents the MIDI composition picker, returning the selected metadata descriptor.  The actual
 * composition body must be fetched separately by id via `getMIDIComposition`.
 */
export const mkLoadMIDICompositionModal = () =>
  pickPresetWithModal(wrappedGetSavedMIDICompositions);
