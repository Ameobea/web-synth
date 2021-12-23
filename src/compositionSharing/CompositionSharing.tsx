import React, { useState } from 'react';
import * as R from 'ramda';

import './CompositionSharing.scss';
import { onBeforeUnload, reinitializeWithComposition } from '../persistance';
import { getEngine } from 'src/util';
import { getSample, SampleDescriptor } from 'src/sampleLibrary';
import { renderModalWithControls, ModalCompProps } from 'src/controls/Modal';
import FlatButton from 'src/misc/FlatButton';
import BasicModal from 'src/misc/BasicModal';
import {
  fetchAllSharedCompositions,
  getExistingCompositionTags,
  getLoadedComposition,
  saveComposition,
  storeRemoteSample,
} from 'src/api';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import {
  pickPresetWithModal,
  PresetDescriptor,
} from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { getState } from 'src/redux';

export interface CompositionDefinition {
  id: number;
  title: string;
  author: number;
  description: string;
  content: string;
}

const mkLocalSamplesConfirmation = (localSamples: SampleDescriptor[]) => {
  const LocalSamplesConfirmation: React.FC<ModalCompProps<void>> = ({
    onSubmit,
    onCancel,
  }: ModalCompProps<void>) => (
    <BasicModal style={{ width: 500 }}>
      The current composition makes use of one or more samples loaded from your local filesystem.
      They are as follows:
      <ul>
        {localSamples.map(sample => (
          <li key={sample.name}>{sample.name}</li>
        ))}
      </ul>
      <p>
        In order to share this composition, you will need to convert them into remote samples which
        means that they will be uploaded to the cloud and made publicly available to anyone who
        views your shared composition. If you choose to upload the sample(s), you must have the
        proper legal rights to share them in that manner.
      </p>
      <p>
        By clicking the &quot;Upload&quot; button below, you attest that you have the necessary
        legal rights to share the above listed sample(s) publicly and agree to have them uploaded to
        the cloud and made publicly available to anyone who accesses the shared composition.
      </p>
      <div>
        <FlatButton onClick={() => onSubmit(void 0)}>Upload</FlatButton>
        <FlatButton onClick={onCancel}>Cancel</FlatButton>
      </div>
    </BasicModal>
  );
  return LocalSamplesConfirmation;
};

const uploadLocalSamples = async (localSamples: SampleDescriptor[]) => {
  console.log('Preparing to upload local samples...', localSamples);

  return Promise.all(
    localSamples.map(async descriptor => {
      // The sample is active, so it must be in the in-memory cache
      const sampleData = await getSample(descriptor);
      return storeRemoteSample(descriptor, sampleData);
    })
  );
};

const checkForLocalSamples = async () => {
  const activeSamples: SampleDescriptor[] = getEngine()!.get_active_samples();
  const activeLocalSamples = activeSamples.reduce((acc, descriptor) => {
    if (!descriptor.isLocal) {
      return acc;
    }

    acc.set(descriptor.name, descriptor);
    return acc;
  }, new Map() as Map<string, SampleDescriptor>);

  if (activeLocalSamples.size === 0) {
    return null;
  }

  const activeLocalSamplesList = [...activeLocalSamples.values()];
  await renderModalWithControls(mkLocalSamplesConfirmation(activeLocalSamplesList));

  const remoteSamples = await uploadLocalSamples(activeLocalSamplesList);

  return [
    activeSamples,
    remoteSamples.map(sample => ({
      isLocal: false,
      name: sample.name,
      url: sample.sampleUrl,
      id: sample.id,
    })),
  ] as const;
};

const updateSamplesInSave = (
  save: any,
  samples: readonly [SampleDescriptor[], SampleDescriptor[]]
): any => {
  if (Array.isArray(save)) {
    return save.map(save => updateSamplesInSave(save, samples));
  } else if (!save || typeof save !== 'object') {
    return save;
  }

  // Check to see if this object is a local sample and if so, replace it with its remote equivalent
  if (save.isLocal === true) {
    const matchingIx = samples[0].findIndex(sample => R.equals(sample, save));
    if (matchingIx !== -1) {
      console.log('Found match for sample: ', save);
      console.log('Replacing with: ', samples[1][matchingIx]);
      return samples[1][matchingIx];
    } else {
      console.warn("Found `isLocal` but didn't match any samples: ", save);
    }
  }

  return Object.fromEntries(
    Object.entries(save).map(([key, val]) => [key, updateSamplesInSave(val, samples)])
  );
};

const removeCompositionSharingFromVCMState = (serializedVcmState: any) => {
  const vcmState = JSON.parse(serializedVcmState);

  // Select control panel, graph editor, synth designer in that order if exist as the default active view
  let bestScore = 0;
  for (let i = 0; i < vcmState.view_context_ids.length; i++) {
    const vcId = vcmState.view_context_ids[i];
    const state = localStorage[`vc_${vcId}`];
    try {
      const parsedState = JSON.parse(state);
      const score =
        (
          {
            control_panel: 10,
            graph_editor: 9,
            synth_designer: 8,
          } as { [key: string]: number }
        )[`${parsedState?.minimal_def?.name}`] ?? 0;

      if (score >= bestScore) {
        bestScore = score;
        vcmState.active_view_ix = i;
      }
    } catch (e) {
      continue;
    }
  }

  return JSON.stringify({
    ...vcmState,
    view_context_ids: vcmState.view_context_ids.filter((vcId: string) => {
      const state = localStorage[`vc_${vcId}`];
      if (!state) {
        return true;
      }

      try {
        const parsedState = JSON.parse(state);
        return parsedState?.minimal_def?.name !== 'composition_sharing';
      } catch (e) {
        return true;
      }
    }),
  });
};

const serializeAndSaveComposition = async ({
  title,
  description,
  tags,
}: {
  title: string;
  description: string;
  tags: string[];
}): Promise<number> => {
  // Check to see if any local compositions are in use by the composition.  If so, check confirm with
  // the user whether or not they should be uploaded and handle converting them to remote samples.
  const samples = await checkForLocalSamples();

  // Trigger all VCs to save to localStorage, tearing them down in the process.
  const engine = getEngine()!;
  onBeforeUnload(engine);

  let compositionData = R.clone({ ...localStorage } as any);
  compositionData.vcmState = removeCompositionSharingFromVCMState(compositionData.vcmState);
  if (samples) {
    const [jsonEntries, passthruEntries] = R.partition(([_key, val]) => {
      try {
        JSON.parse(val as any);
        return true;
      } catch (err) {
        return false;
      }
    }, Object.entries(compositionData));

    compositionData = {
      ...Object.fromEntries(passthruEntries),
      ...Object.fromEntries(
        jsonEntries.map(([key, val]) => [
          key,
          JSON.stringify(updateSamplesInSave(JSON.parse(val as any), samples)),
        ])
      ),
    };
  }

  let compositionID: number | null = null;
  let saveCompositionError: any = null;
  try {
    compositionID = await saveComposition(title, description, compositionData, tags);
  } catch (err) {
    console.error('Error saving composition: ', err);
    saveCompositionError = err;
  } finally {
    // Re-initialize
    engine.init();
  }

  if (compositionID !== null) {
    return compositionID;
  }
  throw saveCompositionError;
};

const ShareComposition: React.FC = () => {
  const [savedCompositionID, setSavedCompositionID] = useState<number | null>(null);

  return (
    <>
      <button
        onClick={async () => {
          try {
            const {
              name: title,
              description,
              tags,
            } = await renderGenericPresetSaverWithModal({
              description: true,
              getExistingTags: getExistingCompositionTags,
            });

            const savedCompositionID = await serializeAndSaveComposition({
              title,
              description: description ?? '',
              tags: tags ?? [],
            });
            setSavedCompositionID(savedCompositionID);
          } catch (err) {
            if (!err) {
              return;
            }

            alert('Error saving composition: ' + err);
          }
        }}
      >
        Share Current Composition
      </button>
      {savedCompositionID !== null ? (
        <span style={{ color: 'green' }}>Composition {savedCompositionID} saved successfully!</span>
      ) : null}
    </>
  );
};

const CompositionSharing: React.FC = () => (
  <div className='composition-sharing'>
    <h2>Share or Load Online Composition</h2>
    <p>
      Browse and load compositions created by other users or share your own composition for others
      to try out
    </p>

    <div className='buttons-container'>
      <ShareComposition />
      <button
        onClick={async () => {
          const wrappedGetAllSharedCompositions = (): Promise<PresetDescriptor<any>[]> =>
            fetchAllSharedCompositions().then(compositions =>
              compositions.map(comp => ({ ...comp, name: comp.title, preset: null }))
            );

          let compID: string | number = '';
          try {
            const pickedComp = await pickPresetWithModal(wrappedGetAllSharedCompositions);
            compID = pickedComp.id;
          } catch (err) {
            if (!err) {
              return;
            }
            console.error(
              'Error picking composition or getting list of shared compositions from the API: ',
              err
            );
            alert(
              'Error getting list of compositions from the API or rendering preset picker: ' + err
            );
            return;
          }

          const composition = await getLoadedComposition(compID);
          if (!composition) {
            return;
          }
          const allViewContextIds = getState().viewContextManager.activeViewContexts.map(
            R.prop('uuid')
          );
          reinitializeWithComposition(composition.content, getEngine()!, allViewContextIds);
        }}
      >
        Load Composition
      </button>
    </div>
  </div>
);

export default CompositionSharing;
