import { useWindowSize } from 'ameo-utils/dist/util/react';
import React, { useMemo } from 'react';
import { useQuery } from 'react-query';
import { useSelector } from 'react-redux';
import { FixedSizeList as List } from 'react-window';
import { Tag } from 'src/controls/GenericPresetPicker/GenericPresetSaver';

import { ModalCompProps, renderModalWithControls } from 'src/controls/Modal';
import BasicModal from 'src/misc/BasicModal';
import { withReactQueryClient, withReduxProvider } from 'src/reactUtils';
import { genericPresetDispatch, ReduxStore, store } from 'src/redux';
import { genericPresetPickerActions } from 'src/redux/modules/genericPresetPicker';
import './GenericPresetPicker.scss';

export interface PresetDescriptor<T> {
  id: string | number;
  name: string;
  description?: string | null | undefined;
  tags?: string[];
  preset: T;
}

function mkPresetRow<T>(
  presets: PresetDescriptor<T>[]
): React.FC<{ index: number; style: React.CSSProperties }> {
  const PresetRow: React.FC<{ index: number; style: React.CSSProperties }> = ({ index, style }) => {
    const preset = presets[index];
    const isSelected = useSelector(
      (state: ReduxStore) => state.genericPresetPicker.selectedPresetIx === index
    );

    return (
      <div
        style={style}
        className='generic-preset-picker-row'
        data-selected={`${isSelected ?? false}`}
        onClick={() => genericPresetDispatch(genericPresetPickerActions.setSelectedPresetIx(index))}
      >
        {preset.name}
      </div>
    );
  };
  return React.memo(PresetRow);
}

interface PresetInfoProps {
  preset: PresetDescriptor<any>;
}

const PresetInfo: React.FC<PresetInfoProps> = ({ preset }) => {
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
      {preset.tags && preset.tags.length > 0 ? (
        <div className='preset-info-item '>
          <div>Tags</div>
          <div className='tags-container'>
            {preset.tags.map(tag => (
              <Tag key={tag} isSelected name={tag} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const GenericPresetPickerContainer: React.FC = ({ children }) => (
  <BasicModal className='generic-preset-picker'>{children}</BasicModal>
);

function mkGenericPresetPicker<T>(
  getPresets: () => Promise<PresetDescriptor<T>[]>
): React.FC<ModalCompProps<PresetDescriptor<T>>> {
  genericPresetDispatch(genericPresetPickerActions.setSelectedPresetIx(null));

  const GenericPresetPicker: React.FC<ModalCompProps<PresetDescriptor<T>>> = ({
    onSubmit,
    onCancel,
  }) => {
    const { data: presets, error: fetchPresetsError } = useQuery('presets', getPresets);
    const windowSize = useWindowSize();
    const PresetRow = useMemo(() => (presets ? mkPresetRow(presets) : null), [presets]);
    const selectedPresetIx = useSelector(
      (state: ReduxStore) => state.genericPresetPicker.selectedPresetIx
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

    return (
      <GenericPresetPickerContainer>
        <List
          className='preset-list'
          height={Math.max(windowSize.height - 150, 200)}
          width={Math.max(windowSize.width * 0.18, 200)}
          itemSize={24}
          itemCount={presets.length}
        >
          {PresetRow}
        </List>
        <div className='preset-info-wrapper'>
          {selectedPresetIx !== null ? (
            <PresetInfo preset={presets[selectedPresetIx]} />
          ) : (
            <p className='select-preset-prompt'>
              Select a preset from the list on the left to view info about it
            </p>
          )}
          <div className='buttons-container'>
            <button onClick={onCancel}>Cancel</button>
            {selectedPresetIx === null ? null : (
              <button onClick={() => onSubmit(presets[selectedPresetIx])}>Load</button>
            )}
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
