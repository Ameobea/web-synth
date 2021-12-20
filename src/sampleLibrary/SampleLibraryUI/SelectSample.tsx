/**
 * React component that renders a list of samples and allows users to select one along with previewing them
 */

import React, { useState } from 'react';
import type { ListChildComponentProps } from 'react-window';

import { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import BasicModal from 'src/misc/BasicModal';
import {
  SampleListing,
  MkSampleListingRowRendererArgs,
  SampleRow,
  LoadSamplesButtons,
} from './SampleLibraryUI';
import useAllSamples from './useAllSamples';
import { renderModalWithControls } from 'src/controls/Modal';
import FlatButton from 'src/misc/FlatButton';

const mkSampleListingRowRenderer = ({
  sampleDescriptors,
  playingSample,
  togglePlaying,
  selectedSample,
  setSelectedSample,
}: MkSampleListingRowRendererArgs): React.FC<ListChildComponentProps> => {
  const SampleListingRowRenderer: React.FC<ListChildComponentProps> = ({ style, index }) => (
    <SampleRow
      togglePlaying={() => togglePlaying(sampleDescriptors[index])}
      isPlaying={sampleDescriptors[index].name === playingSample?.name}
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
  const {
    allSamples,
    includeLocalSamples,
    setIncludeLocalSamples,
    setIncludeRemoteSamples,
    includeRemoteSamples,
  } = useAllSamples();

  return (
    <>
      <LoadSamplesButtons
        localSamplesLoaded={includeLocalSamples}
        loadLocalSamples={() => setIncludeLocalSamples(true)}
        remoteSamplesLoaded={includeRemoteSamples}
        loadRemoteSamples={() => setIncludeRemoteSamples(true)}
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

      <FlatButton
        disabled={!selectedSample}
        onClick={() => onSubmit(selectedSample!.sample)}
        style={{ marginTop: 10 }}
      >
        Submit
      </FlatButton>
      {onCancel ? <FlatButton onClick={onCancel}>Cancel</FlatButton> : null}
    </BasicModal>
  );
};

export const selectSample = () => renderModalWithControls(SampleSelectDialog);

export default SampleSelectDialog;
