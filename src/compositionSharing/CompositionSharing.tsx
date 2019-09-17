import React, { useState } from 'react';
import { connect } from 'react-redux';
import { Field, reduxForm, InjectedFormProps } from 'redux-form';
import * as R from 'ramda';

import { useOnce } from '../hooks';
import { BACKEND_BASE_URL } from '../conf';
import { ReduxStore } from '../redux';
import './CompositionSharing.scss';
import { loadComposition } from '../persistance';

interface CompositionDefinition {
  id: number;
  title: string;
  author: number;
  description: string;
  content: string;
}

const fetchAllSharedCompositions = () =>
  fetch(`${BACKEND_BASE_URL}/compositions`).then(res => res.json());

const mapCompositionListingStateToProps = (state: ReduxStore) => ({
  allViewContextIds: state.viewContextManager.activeViewContexts.map(R.prop('uuid')),
});

const CompositionListingInner: React.FC<
  { engine: typeof import('../engine') } & ReturnType<typeof mapCompositionListingStateToProps>
> = ({ engine, allViewContextIds }) => {
  const [allSharedCompositions, setAllSharedCompositions] = useState<
    null | CompositionDefinition[]
  >(null);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);
  useOnce(async () => {
    fetchAllSharedCompositions()
      .then(setAllSharedCompositions)
      .catch(err => setErrorMessage(`Failed to fetch shared compositions: ${err.message}`));
  });

  console.log(allSharedCompositions);

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
      {allSharedCompositions.map(composition => (
        <div className='composition-item'>
          <span className='composition-title' key={composition.id}>
            {composition.title}
          </span>
          <span className='composition-description' key={composition.id}>
            {composition.description}
          </span>
          <button onClick={() => loadComposition(composition.content, engine, allViewContextIds)}>
            Load
          </button>
        </div>
      ))}
    </div>
  );
};

const CompositionListing = connect(mapCompositionListingStateToProps)(CompositionListingInner);

const FieldRenderer: React.FC<{
  input: { [key: string]: any };
  label?: string;
  type: string;
  meta: { touched: boolean; error?: string; warning?: string };
  ComponentOverride?: React.ComponentType<any>;
}> = ({ input, label, type, meta: { touched, error, warning }, ComponentOverride }) => (
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

const ShareCompositionInner: React.FC<
  {} & InjectedFormProps<{ title: string; description: string }>
> = ({ handleSubmit, submitting, submitSucceeded, submitFailed, error }) => {
  return (
    <>
      <form
        className='share-composition-form'
        onSubmit={handleSubmit(async vals => {
          const res = await fetch(`${BACKEND_BASE_URL}/compositions`, {
            method: 'POST',
            body: JSON.stringify({ ...vals, user: 0, content: { ...localStorage } }),
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!res.ok) {
            throw new Error(`Error while submitting composition: ${await res.text()}`);
          }
        })}
      >
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
      {submitFailed ? 'Submissin Failed' : null}
      {error ? <span style={{ color: '#bb2312' }}>{error}</span> : null}
    </>
  );
};

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
  <>
    <ShareComposition />
    <CompositionListing engine={engine} />
  </>
);

export default CompositionSharing;
