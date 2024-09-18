import * as R from 'ramda';
import React, { Fragment, useCallback, useEffect, useState } from 'react';

import {
  clearLocalComposition,
  getCurLoadedCompositionId,
  getLoginToken,
  onBeforeUnload,
  reinitializeWithComposition,
} from '../persistance';
import './CompositionSharing.css';
import {
  fetchAllSharedCompositions,
  getExistingCompositionTags,
  getLoadedComposition,
  saveComposition,
  storeRemoteSample,
} from 'src/api';
import {
  pickPresetWithModal,
  type CustomPresetInfoProps,
  type PresetDescriptor,
} from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { renderModalWithControls, type ModalCompProps } from 'src/controls/Modal';
import BasicModal from 'src/misc/BasicModal';
import FlatButton from 'src/misc/FlatButton';
import { getState } from 'src/redux';
import { getSample, type SampleDescriptor } from 'src/sampleLibrary';
import { getSentry } from 'src/sentry';
import { NIL_UUID, formatDateTime, getEngine } from 'src/util';
import { saveSubgraphPreset } from 'src/graphEditor/GraphEditor';

export interface CompositionVersion {
  id: number;
  title: string;
  description: string;
  compositionVersion: number;
  createdAt?: Date | null;
}

export interface CompositionDefinition {
  id: number;
  title: string;
  description: string;
  content: string;
  tags: string[];
  userId: number | null | undefined;
  versions?: CompositionVersion[];
  createdAt?: Date | null;
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
  const activeLocalSamples = activeSamples.reduce(
    (acc, descriptor) => {
      if (!descriptor.isLocal) {
        return acc;
      }

      acc.set(descriptor.name, descriptor);
      return acc;
    },
    new Map() as Map<string, SampleDescriptor>
  );

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

const removeCompositionSharingFromVCMState = (composition: Record<string, any>) => {
  const serializedVcmState = composition.vcmState;
  const activeSubgraphID = getState().viewContextManager.activeSubgraphID;
  const vcmState = JSON.parse(serializedVcmState);

  // Select control panel, graph editor, synth designer in that order if exist as the default active view
  let bestScore = 0;
  for (let i = 0; i < vcmState.view_context_ids.length; i++) {
    const vcId = vcmState.view_context_ids[i];
    const state = localStorage[`vc_${vcId}`];
    try {
      const parsedState = JSON.parse(state);
      if (parsedState.minimal_def.subgraphId !== activeSubgraphID) {
        continue;
      }

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
        vcmState.active_view_id = vcId;
      }
    } catch (_err) {
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
        if (parsedState?.minimal_def?.name !== 'composition_sharing') {
          return true;
        }

        delete composition[`vc_${vcId}`];
        return false;
      } catch (_err) {
        return true;
      }
    }),
  });
};

/**
 * There was a long-standing bug where state entries for MIDI editors weren't cleared out of `localStorage`
 * properly when the MIDI editor was deleted.  This prevents a ton of wasted space from getting used up
 * in saved compositions by cleaning them out.
 */
const removeOrphanEntriesFromComposition = (composition: Record<string, any>) => {
  const activeViewContexts = getState().viewContextManager.activeViewContexts;
  for (const key of Object.keys(composition)) {
    if (key.startsWith('vc_')) {
      const vcId = key.split('vc_')[1];
      if (!activeViewContexts.some(vc => vc.uuid === vcId)) {
        delete composition[key];
        localStorage.removeItem(key);
      }

      continue;
    }

    if (!key.startsWith('midiEditor_')) {
      continue;
    }

    const vcId = key.split('midiEditor_')[1];
    if (!activeViewContexts.some(vc => vc.uuid === vcId)) {
      delete composition[key];
      localStorage.removeItem(key);
    }
  }
};

interface SerializeAndSaveCompositionArgs {
  title: string;
  description: string;
  tags: string[];
  parentID?: number | null;
}

const serializeAndSaveComposition = async ({
  title,
  description,
  tags,
  parentID,
}: SerializeAndSaveCompositionArgs): Promise<number> => {
  // Check to see if any local compositions are in use by the composition.  If so, check confirm with
  // the user whether or not they should be uploaded and handle converting them to remote samples.
  const samples = await checkForLocalSamples();

  // Trigger all VCs to save to localStorage, tearing them down in the process.
  const engine = getEngine()!;
  onBeforeUnload(engine);

  let compositionData = R.clone({ ...localStorage } as any);
  compositionData.vcmState = removeCompositionSharingFromVCMState(compositionData);
  removeOrphanEntriesFromComposition(compositionData);

  if (samples) {
    const [jsonEntries, passthruEntries] = R.partition(([_key, val]) => {
      try {
        JSON.parse(val as any);
        return true;
      } catch (_err) {
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
    compositionID = await saveComposition(title, description, compositionData, tags, parentID);
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

const handleSave = async (parentID: number | null): Promise<number | null> => {
  if (parentID) {
    const isLoggedIn = !!(await getLoginToken());
    if (!isLoggedIn) {
      alert('You must be logged in to save a new version of a composition');
      return null;
    }
  }

  try {
    const {
      name: title,
      description,
      tags,
    } = await renderGenericPresetSaverWithModal({
      description: true,
      tags: !parentID,
      getExistingTags: getExistingCompositionTags,
      title: parentID ? 'Save New Version' : 'Save Composition',
    });

    getSentry()?.captureMessage('Saving composition', {
      tags: {
        title,
        description,
        tags: tags?.join(','),
        parentID,
      },
    });
    const savedCompositionID = await serializeAndSaveComposition({
      title,
      description: description ?? '',
      tags: tags ?? [],
      parentID,
    });
    toastSuccess(`Successfully saved as composition ${savedCompositionID}`);
    return savedCompositionID;
  } catch (err) {
    if (!err) {
      return null;
    }

    getSentry()?.captureException(err);
    alert('Error saving composition: ' + err);

    return null;
  }
};

const ShareComposition: React.FC = () => {
  const [savedCompositionID, setSavedCompositionID] = useState<number | null>(null);
  const [curEditingCompositionID, setCurEditingCompositionID] = useState<number | null>(null);
  useEffect(() => void getCurLoadedCompositionId().then(setCurEditingCompositionID), []);

  const handleSaveInner = useCallback(
    async (parentID: number | null) => {
      const savedCompositionID = await handleSave(parentID);
      setSavedCompositionID(savedCompositionID);
    },
    [setSavedCompositionID]
  );

  return (
    <div className='buttons-section'>
      <button onClick={() => handleSaveInner(null)}>Save as New Composition</button>
      {curEditingCompositionID !== null ? (
        <button onClick={() => handleSaveInner(curEditingCompositionID)}>
          Save as New Version
        </button>
      ) : null}
      <button onClick={() => saveSubgraphPreset(NIL_UUID, true)}>Save as Subgraph</button>
      {savedCompositionID !== null ? (
        <span style={{ color: 'green' }}>Composition {savedCompositionID} saved successfully!</span>
      ) : null}
    </div>
  );
};

interface CompositionCreatedAtDisplayProps {
  createdAt: Date | null | undefined;
}

const CompositionCreatedAtDisplay: React.FC<CompositionCreatedAtDisplayProps> = ({ createdAt }) => {
  if (!createdAt) {
    return <i>-</i>;
  }

  return <>{formatDateTime(createdAt)}</>;
};

const CompositionCustomDetails: React.FC<
  CustomPresetInfoProps<Omit<CompositionDefinition, 'content'>>
> = ({ preset }) => {
  const versions = preset.preset.versions;
  if (!versions || versions.length === 0) {
    return null;
  }

  return (
    <div className='composition-custom-details'>
      <h2>Version History</h2>
      <div className='composition-versions-listing'>
        <Fragment>
          <div className='composition-id'>{preset.id}</div>
          <div className='composition-title'>
            <i>Original</i>
          </div>
          <div className='composition-created-at'>
            <CompositionCreatedAtDisplay createdAt={preset.preset.createdAt} />
          </div>
          <div className='composition-description' />
        </Fragment>
        {(preset.preset.versions ?? []).map(
          ({ compositionVersion, title, description, createdAt, id }) => (
            <Fragment key={compositionVersion}>
              <div className='composition-id'>{id}</div>
              <div className='composition-title'>{title}</div>
              <div className='composition-created-at'>
                <CompositionCreatedAtDisplay createdAt={createdAt} />
              </div>
              <div className='composition-description'>{description}</div>
            </Fragment>
          )
        )}
      </div>
    </div>
  );
};

const LoadComposition: React.FC = () => (
  <div className='buttons-section'>
    <button
      onClick={async () => {
        const wrappedGetAllSharedCompositions = (): Promise<
          PresetDescriptor<Omit<CompositionDefinition, 'content'>>[]
        > =>
          fetchAllSharedCompositions().then(compositions =>
            compositions.map(comp => ({ ...comp, name: comp.title, preset: comp }))
          );

        let compID: string | number = '';
        try {
          const pickedComp = await pickPresetWithModal(
            wrappedGetAllSharedCompositions,
            undefined,
            CompositionCustomDetails
          );
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
        await clearLocalComposition();
        reinitializeWithComposition(
          { type: 'serialized', value: composition.content, id: +compID },
          getEngine()!,
          allViewContextIds
        );
      }}
    >
      Load Composition
    </button>
  </div>
);

const CompositionSharing: React.FC = () => (
  <div className='composition-sharing'>
    <h2>Share or Load Online Composition</h2>
    <p>
      Browse and load compositions created by other users or share your own composition for others
      to try out
    </p>

    <div className='buttons-container'>
      <ShareComposition />
      <LoadComposition />
    </div>
  </div>
);

export default CompositionSharing;
