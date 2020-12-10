/**
 * React component that renders a list of samples and allows users to select one along with previewing them
 */

import React, { useState } from 'react';
import { ListRowRenderer } from 'react-virtualized';
import { UnimplementedError } from 'ameo-utils';

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
}: MkSampleListingRowRendererArgs): ListRowRenderer => {
  const SampleListingRowRenderer: React.FC<{
    style?: any;
    index: number;
    key: string;
  }> = ({ style, index, key }) => (
    <SampleRow
      togglePlaying={() => togglePlaying(sampleDescriptors[index])}
      isPlaying={sampleDescriptors[index].name === playingSample?.name}
      descriptor={sampleDescriptors[index]}
      key={key}
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

const SelectSample: React.FC<{
  selectedSample: { sample: SampleDescriptor; index: number } | null;
  setSelectedSample: (
    newSelectedSample: { sample: SampleDescriptor; index: number } | null
  ) => void;
}> = ({ selectedSample, setSelectedSample }) => {
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
        sampleDescriptors={typeof allSamples === 'string' ? [] : allSamples || []}
        height={600}
        width={800}
      />
    </>
  );
};

const SampleSelectDialog: React.FC<{
  onSubmit: (val: SampleDescriptor) => void;
  onCancel?: () => void;
}> = ({ onSubmit, onCancel }) => {
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

export const selectSample = (): Promise<SampleDescriptor> =>
  renderModalWithControls(SampleSelectDialog);

export default SampleSelectDialog;
