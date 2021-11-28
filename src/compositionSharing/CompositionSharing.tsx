import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Field, reduxForm, InjectedFormProps } from 'redux-form';
import * as R from 'ramda';
import { Table } from 'react-virtualized';
import { useOnce } from 'ameo-utils/util/react';

import { ReduxStore } from '../redux';
import './CompositionSharing.scss';
import { loadComposition, onBeforeUnload } from '../persistance';
import { getEngine } from 'src/util';
import { getSample, SampleDescriptor } from 'src/sampleLibrary';
import { renderModalWithControls, ModalCompProps } from 'src/controls/Modal';
import FlatButton from 'src/misc/FlatButton';
import BasicModal from 'src/misc/BasicModal';
import { fetchAllSharedCompositions, saveComposition, storeRemoteSample } from 'src/api';

export interface CompositionDefinition {
  id: number;
  title: React.ReactNode;
  author: number;
  description: React.ReactNode;
  content: string;
}

const CompositionItem: React.FC<
  {
    composition: CompositionDefinition;
    engine: typeof import('../engine');
    allViewContextIds: string[];
    showButton?: boolean;
  } & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>
> = ({ composition, engine, allViewContextIds, showButton = true, className, ...props }) => (
  <div className={`composition-item${className ? ' ' + className : ''}`} {...props}>
    <div className='composition-title'>{composition.title}</div>
    <div className='composition-description'>{composition.description}</div>
    {showButton ? (
      <button onClick={() => loadComposition(composition.content, engine, allViewContextIds)}>
        Load
      </button>
    ) : (
      <div style={{ maxWidth: 60 }} />
    )}
  </div>
);

const CompositionListing: React.FC<{ engine: typeof import('../engine') }> = ({ engine }) => {
  const [allSharedCompositions, setAllSharedCompositions] = useState<
    null | CompositionDefinition[]
  >(null);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);
  useOnce(async () => {
    fetchAllSharedCompositions()
      .then(setAllSharedCompositions)
      .catch(err => setErrorMessage(`Failed to fetch shared compositions: ${err.message}`));
  });
  const allViewContextIds = useSelector((state: ReduxStore) =>
    state.viewContextManager.activeViewContexts.map(R.prop('uuid'))
  );

  if (!allSharedCompositions) {
    if (errorMessage) {
      return <>{errorMessage}</>;
    } else {
      return <span>Loading...</span>;
    }
  }

  return (
    <div className='shared-composition-listing'>
      <h2>Browse Shared Compositions</h2>
      <Table
        headerHeight={26}
        height={600}
        rowCount={allSharedCompositions.length}
        rowGetter={({ index }) => allSharedCompositions[index]}
        rowRenderer={({ className, style, rowData, key }) => (
          <CompositionItem
            composition={rowData}
            engine={engine}
            allViewContextIds={allViewContextIds}
            className={className}
            style={style}
            key={key}
          />
        )}
        headerRowRenderer={({ className, style }) => (
          <CompositionItem
            showButton={false}
            composition={{
              id: -1,
              content: '',
              author: -1,
              title: <b>Title</b>,
              description: <b>Description</b>,
            }}
            engine={engine}
            allViewContextIds={allViewContextIds}
            className={className}
            style={{ ...style, borderBottom: '1px solid #999', marginBottom: 6 }}
          />
        )}
        rowHeight={140}
        width={window.innerWidth - 80}
        row
      />
    </div>
  );
};

interface FieldRendererProps {
  input: { [key: string]: any };
  label?: string;
  type: string;
  meta: { touched: boolean; error?: string; warning?: string };
  ComponentOverride?: React.ComponentType<any>;
}

const FieldRenderer: React.FC<FieldRendererProps> = ({
  input,
  label,
  type,
  meta: { touched, error, warning },
  ComponentOverride,
}) => (
  <div className='custom-field-renderer'>
    <label>{label}</label>
    <div>
      {ComponentOverride ? <ComponentOverride {...input} /> : <input {...input} type={type} />}
    </div>
    <div>
      {touched ? (
        <>
          {error ? <span style={{ color: '#bb2312' }}>{error}</span> : null}
          {warning ? <span style={{ color: '#bb7302' }}>{warning}</span> : null}
        </>
      ) : null}
    </div>
  </div>
);

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
      name: sample.id,
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
}: {
  title: string;
  description: string;
}) => {
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

  try {
    const res = await saveComposition(title, description, compositionData);
    if (!res.ok) {
      console.error(`Error while submitting composition: ${await res.text()}`);
      alert(`Error while submitting composition: ${await res.text()}`);
    }
  } catch (err) {
    console.error('Error saving composition: ', err);
    alert('Error saving composition: ' + `${err}`);
  } finally {
    // Re-initialize
    engine.init();
  }
};

const ShareCompositionInner: React.FC<
  InjectedFormProps<{
    title: string;
    description: string;
  }>
> = ({ handleSubmit, submitting, submitSucceeded, submitFailed, error }) => (
  <>
    <form className='share-composition-form' onSubmit={handleSubmit(serializeAndSaveComposition)}>
      <h2>Share Composition</h2>
      <Field name='title' component={FieldRenderer} type='text' label='Title' />
      <Field
        name='description'
        component={FieldRenderer}
        ComponentOverride={({ ...args }) => <textarea {...args} />}
        type='text'
        label='Description'
      />
      <button disabled={submitting} type='submit'>
        Submit
      </button>
    </form>
    {submitSucceeded ? 'Successfully submitted!' : null}
    {submitFailed && error ? 'Submission Failed' : null}
    {error ? <span style={{ color: '#bb2312' }}>{error}</span> : null}
  </>
);

const ShareComposition = reduxForm<{ title: string; description: string }>({
  form: 'compositionSharing',
  validate: ({ title, description }) => {
    const errors: { [key: string]: string } = {};

    if (!title) {
      errors.title = 'You must supply a title';
    }
    if (!description) {
      errors.description = 'You must supply a description';
    }

    return errors;
  },
})(ShareCompositionInner);

const CompositionSharing: React.FC<{ engine: typeof import('../engine') }> = ({ engine }) => (
  <div className='composition-sharing'>
    <ShareComposition />
    <CompositionListing engine={engine} />
  </div>
);

export default CompositionSharing;
