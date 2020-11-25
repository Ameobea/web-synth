import React, { useState } from 'react';
import { connect } from 'react-redux';
import { Field, reduxForm, InjectedFormProps } from 'redux-form';
import * as R from 'ramda';
import { Table } from 'react-virtualized';
import { useOnce } from 'ameo-utils/util/react';

import { BACKEND_BASE_URL } from '../conf';
import { ReduxStore } from '../redux';
import './CompositionSharing.scss';
import { loadComposition } from '../persistance';

export interface CompositionDefinition {
  id: number;
  title: React.ReactNode;
  author: number;
  description: React.ReactNode;
  content: string;
}

const fetchAllSharedCompositions = (): Promise<CompositionDefinition[]> =>
  fetch(`${BACKEND_BASE_URL}/compositions`).then(res => res.json());

const mapCompositionListingStateToProps = (state: ReduxStore) => ({
  allViewContextIds: state.viewContextManager.activeViewContexts.map(R.prop('uuid')),
});

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
        rowHeight={120}
        width={800}
        row
      />
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
  {} & InjectedFormProps<{
    title: string;
    description: string;
  }>
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
  <div className='composition-sharing'>
    <ShareComposition />
    <CompositionListing engine={engine} />
  </div>
);

export default CompositionSharing;
