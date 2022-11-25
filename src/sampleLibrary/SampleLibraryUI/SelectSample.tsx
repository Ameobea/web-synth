/**
 * React component that renders a list of samples and allows users to select one along with previewing them
 */
import React, { useState } from 'react';
import type { ListChildComponentProps } from 'react-window';

import { renderModalWithControls } from 'src/controls/Modal';
import BasicModal from 'src/misc/BasicModal';
import FlatButton from 'src/misc/FlatButton';
import { withReactQueryClient } from 'src/reactUtils';
import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import {
  LoadSamplesButtons,
  SampleListing,
  SampleRow,
  type MkSampleListingRowRendererArgs,
} from './SampleLibraryUI';
import useAllSamples from './useAllSamples';

const mkSampleListingRowRenderer = ({
  sampleDescriptors,
  playingSampleName,
  togglePlaying,
  selectedSample,
  setSelectedSample,
}: MkSampleListingRowRendererArgs): React.FC<ListChildComponentProps> => {
  const SampleListingRowRenderer: React.FC<ListChildComponentProps> = ({ style, index }) => (
    <SampleRow
      togglePlaying={() => togglePlaying(sampleDescriptors[index])}
      isPlaying={sampleDescriptors[index].name === playingSampleName}
      descriptor={sampleDescriptors[index]}
      style={{
        ...(style || {}),
        ...(selectedSample?.sample === sampleDescriptors[index]
          ? { backgroundColor: 'rgba(101, 0, 120, 0.5)' }
          : {}),
        cursor: 'pointer',
        userSelect: 'none',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
      onClick={() =>
        setSelectedSample(
          selectedSample?.sample === sampleDescriptors[index]
            ? null
            : { sample: sampleDescriptors[index], index }
        )
      }
    />
  );
  return SampleListingRowRenderer;
};

interface SelectSampleProps {
  selectedSample: { sample: SampleDescriptor; index: number } | null;
  setSelectedSample: (
    newSelectedSample: { sample: SampleDescriptor; index: number } | null
  ) => void;
}

const SelectSample: React.FC<SelectSampleProps> = ({ selectedSample, setSelectedSample }) => {
  const { allSamples, includeLocalSamples, setIncludeLocalSamples } = useAllSamples();

  return (
    <>
      <LoadSamplesButtons
        localSamplesLoaded={includeLocalSamples}
        loadLocalSamples={() => setIncludeLocalSamples(true)}
      />

      <SampleListing
        selectedSample={selectedSample ?? null}
        setSelectedSample={setSelectedSample}
        mkRowRenderer={mkSampleListingRowRenderer}
        sampleDescriptors={allSamples}
        height={600}
        width={800}
      />
    </>
  );
};

interface SampleSelectDialogProps {
  onSubmit: (val: SampleDescriptor) => void;
  onCancel?: () => void;
}

const SampleSelectDialog: React.FC<SampleSelectDialogProps> = ({ onSubmit, onCancel }) => {
  const [selectedSample, setSelectedSample] = useState<{
    sample: SampleDescriptor;
    index: number;
  } | null>(null);

  return (
    <BasicModal style={{ width: 800, alignItems: 'center' }}>
      <SelectSample
        selectedSample={selectedSample}
        setSelectedSample={sample => setSelectedSample(sample)}
      />

      <div className='sample-select-dialog-buttons-container'>
        {onCancel ? <FlatButton onClick={onCancel}>Cancel</FlatButton> : null}
        <FlatButton disabled={!selectedSample} onClick={() => onSubmit(selectedSample!.sample)}>
          Submit
        </FlatButton>
      </div>
    </BasicModal>
  );
};

export const selectSample = () => renderModalWithControls(withReactQueryClient(SampleSelectDialog));

export default SampleSelectDialog;
