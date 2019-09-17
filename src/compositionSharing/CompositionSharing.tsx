import React, { useState, LabelHTMLAttributes } from 'react';
import { Field, reduxForm, InjectedFormProps } from 'redux-form';
import * as R from 'ramda';

import { useOnce } from '../hooks';
import { BACKEND_BASE_URL } from '../conf';
import './CompositionSharing.scss';

const fetchAllSharedCompositions = () =>
  fetch(`${BACKEND_BASE_URL}/compositions`).then(res => res.json());

const CompositionListing: React.FC<{}> = () => {
  const [allSharedCompositions, setAllSharedCompositions] = useState<null | unknown[]>(null);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);
  useOnce(async () => {
    fetchAllSharedCompositions()
      .then(setAllSharedCompositions)
      .catch(err => setErrorMessage(`Failed to fetch shared compositions: ${err.message}`));
  });

  if (!allSharedCompositions) {
    if (errorMessage) {
      return <>{errorMessage}</>;
    } else {
      return <span>Loading...</span>;
    }
  }

  return (
    <>
      <h2>Browse Shared Compositions</h2>
      {allSharedCompositions.map(composition => (
        <span key={composition.id}>{composition.name}</span>
      ))}
    </>
  );
};

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

const CompositionSharing: React.FC<{}> = () => (
  <>
    <ShareComposition />
    <CompositionListing />
  </>
);

export default CompositionSharing;
