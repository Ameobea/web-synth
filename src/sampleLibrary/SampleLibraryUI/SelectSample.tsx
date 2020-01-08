/**
 * React component that renders a list of samples and allows users to select one along with previewing them
 */

import React, { useState } from 'react';
import { ListRowRenderer } from 'react-virtualized';

import { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import { SampleListing, MkDefaultSampleListingRowRendererArgs, SampleRow } from './SampleLibraryUI';
import useAllSamples from './useAllSamples';

const mkSampleListingRowRenderer = ({
  sampleDescriptors,
  playingSample,
  togglePlaying,
  selectedSample,
  setSelectedSample,
}: MkDefaultSampleListingRowRendererArgs & {
  selectedSample: SampleDescriptor | null;
  setSelectedSample: (newSelectedSample: SampleDescriptor | null) => void;
}): ListRowRenderer => ({ style, index, key }) => (
  <SampleRow
    togglePlaying={() => togglePlaying(sampleDescriptors[index])}
    isPlaying={sampleDescriptors[index].name === playingSample?.name}
    descriptor={sampleDescriptors[index]}
    key={key}
    style={{
      ...(style || {}),
      ...(selectedSample === sampleDescriptors[index] ? { backgroundColor: '#b0d' } : {}),
    }}
    onClick={() =>
      setSelectedSample(
        selectedSample === sampleDescriptors[index] ? null : sampleDescriptors[index]
      )
    }
  />
);

const SelectSample: React.FC<{
  selectedSample: SampleDescriptor | null;
  setSelectedSample: (newSelectedSample: SampleDescriptor | null) => void;
}> = ({ selectedSample, setSelectedSample }) => {
  const { allSamples } = useAllSamples();

  return (
    <SampleListing
      extraMkRowRendererArgs={{ selectedSample, setSelectedSample }}
      mkRowRenderer={mkSampleListingRowRenderer}
      sampleDescriptors={typeof allSamples === 'string' ? [] : allSamples || []}
    />
  );
};

const SampleSelectDialog: React.FC<{
  onSubmit: (val: SampleDescriptor) => void;
  onCancel?: () => void;
}> = ({ onSubmit, onCancel }) => {
  const [selectedSample, setSelectedSample] = useState<SampleDescriptor | null>(null);

  return (
    <div>
      <SelectSample selectedSample={selectedSample} setSelectedSample={setSelectedSample} />

      <button disabled={!selectedSample} onClick={() => onSubmit(selectedSample!)}>
        Submit
      </button>
      {onCancel ? <button onClick={onCancel}>Cancel</button> : null}
    </div>
  );
};

export default SampleSelectDialog;
