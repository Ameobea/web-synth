import * as R from 'ramda';
import React, { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { useSelector } from 'react-redux';
import { FixedSizeList as List } from 'react-window';

import { Tag } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { renderModalWithControls, type ModalCompProps } from 'src/controls/Modal';
import BasicModal from 'src/misc/BasicModal';
import { useWindowSize, withReactQueryClient, withReduxProvider } from 'src/reactUtils';
import { genericPresetDispatch, store, type ReduxStore } from 'src/redux';
import { genericPresetPickerActions } from 'src/redux/modules/genericPresetPicker';
// prettier-ignore
import './GenericPresetPicker.scss';

const SEARCH_BAR_HEIGHT = 38;

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ value, onChange }) => {
  return (
    <input
      type='text'
      className='generic-preset-picker-search-bar'
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder='Search by name, description, tags'
    />
  );
};

export interface PresetDescriptor<T> {
  id: string | number;
  name: string;
  description?: string | null | undefined;
  tags?: string[];
  preset: T;
  userID?: number | null;
  userName?: string | null;
}

interface PresetRowProps {
  index: number;
  style: React.CSSProperties;
}

function mkPresetRow<T>(filteredPresets: PresetDescriptor<T>[]): React.FC<PresetRowProps> {
  const PresetRow: React.FC<PresetRowProps> = ({ index, style }) => {
    const preset = filteredPresets[index];
    const isSelected = useSelector(
      (state: ReduxStore) => state.genericPresetPicker.selectedPresetID === preset.id
    );

    return (
      <div
        style={style}
        className='generic-preset-picker-row'
        data-selected={`${isSelected ?? false}`}
        onClick={() =>
          genericPresetDispatch(genericPresetPickerActions.setSelectedPresetID(preset.id))
        }
      >
        {preset.name}
      </div>
    );
  };
  return React.memo(PresetRow);
}

interface PresetInfoProps {
  preset: PresetDescriptor<any>;
  setSearchValue: (value: string) => void;
}

const PresetInfo: React.FC<PresetInfoProps> = ({ preset, setSearchValue }) => {
  return (
    <div className='preset-info'>
      <div className='preset-info-item '>
        <div>Name</div>
        <div>{preset.name}</div>
      </div>
      {preset.description ? (
        <div className='preset-info-item '>
          <div>Description</div>
          <div>{preset.description ?? ''}</div>
        </div>
      ) : null}
      {preset.userName ? (
        <div className='preset-info-item '>
          <div>Author</div>
          <div>{preset.userName}</div>
        </div>
      ) : null}
      {preset.tags && preset.tags.length > 0 ? (
        <div className='preset-info-item '>
          <div>Tags</div>
          <div className='tags-container'>
            {preset.tags.map(tag => (
              <Tag key={tag} isSelected name={tag} onClick={() => setSearchValue(tag)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const filterPresets = (presets: PresetDescriptor<any>[], searchValue: string) => {
  if (searchValue === '') {
    return presets;
  }

  return presets.filter(preset => {
    const nameMatch = preset.name.toLowerCase().includes(searchValue.toLowerCase());
    if (nameMatch) {
      return true;
    }
    const descriptionMatch =
      preset.description && preset.description.toLowerCase().includes(searchValue.toLowerCase());
    if (descriptionMatch) {
      return true;
    }
    const tagsMatch =
      preset.tags && preset.tags.some(tag => tag.toLowerCase().includes(searchValue.toLowerCase()));
    if (tagsMatch) {
      return true;
    }

    return false;
  });
};

interface GenericPresetPickerContainerProps {
  children: React.ReactNode;
}

const GenericPresetPickerContainer: React.FC<GenericPresetPickerContainerProps> = ({
  children,
}) => <BasicModal className='generic-preset-picker'>{children}</BasicModal>;

function mkGenericPresetPicker<T>(
  getPresets: () => Promise<PresetDescriptor<T>[]>
): React.FC<ModalCompProps<PresetDescriptor<T>>> {
  genericPresetDispatch(genericPresetPickerActions.setSelectedPresetID(null));

  const GenericPresetPicker: React.FC<ModalCompProps<PresetDescriptor<T>>> = ({
    onSubmit,
    onCancel,
  }) => {
    const { data: presets, error: fetchPresetsError } = useQuery('presets', getPresets);
    const windowSize = useWindowSize();
    const [searchValue, setSearchValue] = useState('');
    const selectedPresetID = useSelector(
      (state: ReduxStore) => state.genericPresetPicker.selectedPresetID
    );
    const selectedPreset = useMemo(
      () => (R.isNil(selectedPresetID) ? null : presets?.find(p => p.id === selectedPresetID)),
      [presets, selectedPresetID]
    );
    const filteredPresets = useMemo(
      () => (presets ? filterPresets(presets, searchValue) : null),
      [presets, searchValue]
    );
    const PresetRow = useMemo(
      () => (filteredPresets ? mkPresetRow(filteredPresets) : null),
      [filteredPresets]
    );

    if (fetchPresetsError) {
      return (
        <GenericPresetPickerContainer>
          <span style={{ color: 'red' }}>Error fetching presets: {`${fetchPresetsError}`}</span>
        </GenericPresetPickerContainer>
      );
    } else if (!presets || !PresetRow) {
      return (
        <GenericPresetPickerContainer>
          <span>Loading presets...</span>
        </GenericPresetPickerContainer>
      );
    }

    const presetListWidth = Math.max(windowSize.width * 0.18, 200);

    return (
      <GenericPresetPickerContainer>
        <div style={{ width: presetListWidth + 12 }}>
          <SearchBar value={searchValue} onChange={setSearchValue} />
          <List
            className='preset-list'
            height={Math.max(windowSize.height - 150 - SEARCH_BAR_HEIGHT, 200)}
            width={presetListWidth}
            itemSize={24}
            itemCount={filteredPresets?.length ?? 0}
          >
            {PresetRow}
          </List>
        </div>
        <div className='preset-info-wrapper'>
          {selectedPreset ? (
            <PresetInfo preset={selectedPreset} setSearchValue={setSearchValue} />
          ) : (
            <p className='select-preset-prompt'>
              Select a preset from the list on the left to view info about it
            </p>
          )}
          <div className='buttons-container'>
            <button onClick={onCancel}>Cancel</button>
            {selectedPreset ? <button onClick={() => onSubmit(selectedPreset)}>Load</button> : null}
          </div>
        </div>
      </GenericPresetPickerContainer>
    );
  };
  return withReduxProvider(store, withReactQueryClient(GenericPresetPicker)) as React.FC<
    ModalCompProps<PresetDescriptor<T>>
  >;
}

export function pickPresetWithModal<T>(getPresets: () => Promise<PresetDescriptor<T>[]>) {
  return renderModalWithControls(mkGenericPresetPicker(getPresets));
}
