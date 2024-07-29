import { Set as ImmSet } from 'immutable';
import * as R from 'ramda';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { useQuery } from 'react-query';

import type { PresetDescriptor } from 'src/controls/GenericPresetPicker/GenericPresetPicker';
import { type ModalCompProps, renderModalWithControls } from 'src/controls/Modal';
import BasicModal from 'src/misc/BasicModal';
import { withReactQueryClient } from 'src/reactUtils';
import './GenericPresetPicker.css';

interface GenericPresetSaverArgs {
  getExistingTags?: () => Promise<{ name: string; count?: number }[]>;
  /**
   * Whether to show the description section.
   *
   * default: false
   */
  description?: boolean;
  /**
   * Whether to show the tags section.
   *
   * default: true
   */
  tags?: boolean;
  /**
   * The title displayed in the modal.
   */
  title?: string;
}

interface TagProps {
  name: string;
  count?: number;
  isSelected?: boolean;
  onClick?: (name: string) => void;
}

export const Tag: React.FC<TagProps> = ({ name, count, isSelected, onClick }) => (
  <div
    className='tag-picker-tag'
    data-selected={`${isSelected ?? false}`}
    onClick={onClick ? () => onClick(name) : undefined}
  >
    {`${name}${R.isNil(count) ? '' : ` (${count})`}`}
  </div>
);

interface TagPickerProps {
  getExistingTags: () => Promise<{ name: string; count?: number }[]>;
  value: ImmSet<string>;
  onChange: (mapTags: (oldTags: ImmSet<string>) => ImmSet<string>) => void;
}

const TagPicker: React.FC<TagPickerProps> = ({ getExistingTags, value, onChange }) => {
  const { data: existingTags, error } = useQuery('existingTags', () =>
    getExistingTags().then(tags =>
      R.sortWith([R.ascend(R.prop('name')), tag => tag.count ?? 0], tags)
    )
  );
  const [enteredTagName, setEnteredTagNameInner] = useState('');
  const staticEnteredTagName = useRef('');
  const setEnteredTagName = useCallback((name: string) => {
    staticEnteredTagName.current = name;
    setEnteredTagNameInner(name);
  }, []);
  const onControlPanelChange = useCallback(
    (_key: string, val: any) => setEnteredTagName(val),
    [setEnteredTagName]
  );
  const controlPanelState = useMemo(() => ({ 'tag name': enteredTagName }), [enteredTagName]);
  const addTag = useCallback((name: string) => onChange(tags => tags.add(name)), [onChange]);
  const removeTag = useCallback((name: string) => onChange(tags => tags.remove(name)), [onChange]);
  const settings = useMemo(
    () => [
      { type: 'text', label: 'tag name' },
      {
        type: 'button',
        label: 'add new tag',
        action: () => {
          if (!staticEnteredTagName.current) {
            return;
          }
          addTag(staticEnteredTagName.current);
          setEnteredTagName('');
        },
      },
    ],
    [addTag, setEnteredTagName]
  );

  if (!existingTags) {
    return <div className='tag-picker'>Loading...</div>;
  }

  if (error) {
    return (
      <div className='tag-picker'>
        <span style={{ color: 'red' }}>Error fetching existing tags: {`${error}`}</span>
      </div>
    );
  }

  return (
    <div className='tag-picker'>
      <h3>Previously Created Tags</h3>
      <div className='tags-container'>
        {existingTags
          .filter(tag => !value.has(tag.name))
          .map(tag => (
            <Tag onClick={addTag} key={tag.name} name={tag.name} count={tag.count} />
          ))}
      </div>
      <h3>Selected Tags</h3>
      <div className='tags-container'>
        {value.toArray().map(tag => (
          <Tag onClick={removeTag} key={tag} name={tag} isSelected />
        ))}
      </div>

      <ControlPanel
        width={400}
        settings={settings}
        state={controlPanelState}
        onChange={onControlPanelChange}
      />
    </div>
  );
};

type GenericPresetSaverProps = ModalCompProps<Omit<PresetDescriptor<any>, 'preset' | 'id'>>;

const mkGenericPresetSaver = (args: GenericPresetSaverArgs) => {
  const GenericPresetSaver: React.FC<GenericPresetSaverProps> = ({ onSubmit, onCancel }) => {
    const [state, setState] = React.useState({
      name: '',
      description: '',
      tags: ImmSet<string>(),
    });

    return (
      <BasicModal className='generic-preset-saver'>
        <h2>{args.title ?? 'Save Preset'}</h2>

        <div className='generic-preset-saver-form'>
          <div>
            <div>Name: </div>
            <input
              type='text'
              value={state.name}
              onChange={e => setState({ ...state, name: e.target.value })}
            />
          </div>
          {args.description ? (
            <div>
              <div>Description: </div>
              <textarea
                value={state.description}
                onChange={e => setState({ ...state, description: e.target.value })}
              />
            </div>
          ) : null}
        </div>
        {args.tags !== false && args.getExistingTags ? (
          <TagPicker
            getExistingTags={args.getExistingTags}
            value={state.tags}
            onChange={mapTags => setState(state => ({ ...state, tags: mapTags(state.tags) }))}
          />
        ) : null}
        <div className='buttons-container'>
          <button
            disabled={!state.name}
            onClick={() => onSubmit({ ...state, tags: state.tags.toArray() })}
          >
            Save
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </BasicModal>
    );
  };
  return GenericPresetSaver;
};

export const renderGenericPresetSaverWithModal = (args: GenericPresetSaverArgs) =>
  renderModalWithControls(withReactQueryClient(mkGenericPresetSaver(args)));
