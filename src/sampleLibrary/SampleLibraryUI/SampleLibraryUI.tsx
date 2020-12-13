import React, { useEffect, useMemo, useState } from 'react';
import * as R from 'ramda';
import { List, ListRowRenderer } from 'react-virtualized';

import { getSample, SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import Loading from 'src/misc/Loading';
import useAllSamples from './useAllSamples';
import './SampleLibraryUI.scss';

const PlaySampleIcon: React.FC<{
  onClick: () => void;
  isPlaying: boolean;
}> = ({ isPlaying, onClick }) => (
  <div className='play-sample-icon' onClick={onClick}>
    {isPlaying ? '■' : '▶'}
  </div>
);

interface SampleRowProps {
  isPlaying: boolean;
  togglePlaying: () => void;
  descriptor: SampleDescriptor;
  style?: React.CSSProperties;
}

export const SampleRow: React.FC<
  SampleRowProps & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>
> = ({ descriptor, style, togglePlaying, isPlaying, ...rest }) => (
  <div className='sample-row' {...rest} style={style}>
    <PlaySampleIcon isPlaying={isPlaying} onClick={togglePlaying} />
    <span title={descriptor.name}>{descriptor.name}</span>
  </div>
);

export interface MkSampleListingRowRendererArgs {
  sampleDescriptors: SampleDescriptor[];
  playingSample: {
    name: string;
    bufSrc: Promise<AudioBufferSourceNode>;
  } | null;
  togglePlaying: (descriptor: SampleDescriptor) => void;
  selectedSample: { sample: SampleDescriptor; index: number } | null;
  setSelectedSample: (
    newSelectedSample: { sample: SampleDescriptor; index: number } | null
  ) => void;
}

const mkDefaultSampleListingRowRenderer = ({
  sampleDescriptors,
  playingSample,
  togglePlaying,
}: MkSampleListingRowRendererArgs): ListRowRenderer => {
  const DefaultSampleListingRowRenderer: React.FC<any> = ({ style, index, key }) => (
    <SampleRow
      togglePlaying={() => togglePlaying(sampleDescriptors[index])}
      isPlaying={sampleDescriptors[index].name === playingSample?.name}
      descriptor={sampleDescriptors[index]}
      key={key}
      style={style}
    />
  );
  return DefaultSampleListingRowRenderer;
};

const ctx = new AudioContext();

const playSample = async (
  descriptor: SampleDescriptor,
  onFinished: () => void
): Promise<AudioBufferSourceNode> => {
  const buffer = await getSample(descriptor);
  const bufSrc = new AudioBufferSourceNode(ctx);
  bufSrc.buffer = buffer;
  bufSrc.connect((ctx as any).globalVolume);
  bufSrc.onended = onFinished;
  bufSrc.start();

  return bufSrc;
};

export function SampleListing({
  sampleDescriptors,
  mkRowRenderer = mkDefaultSampleListingRowRenderer,
  height = 800,
  width = 500,
  selectedSample,
  setSelectedSample,
}: {
  sampleDescriptors: SampleDescriptor[];
  mkRowRenderer?: (args: MkSampleListingRowRendererArgs) => ListRowRenderer;
  height?: number;
  width?: number;
  selectedSample: { sample: SampleDescriptor; index: number } | null;
  setSelectedSample: (
    newSelectedSample: { sample: SampleDescriptor; index: number } | null
  ) => void;
}) {
  const [playingSample, setPlayingSample] = useState<{
    name: string;
    bufSrc: Promise<AudioBufferSourceNode>;
  } | null>(null);

  const togglePlaying = useMemo(
    () => (descriptor: SampleDescriptor) => {
      if (playingSample?.name === descriptor.name) {
        if (playingSample) {
          playingSample.bufSrc.then(bufSrc => bufSrc.stop());
        }
        setPlayingSample(null);
      } else {
        if (playingSample !== null) {
          playingSample.bufSrc.then(bufSrc => bufSrc.stop());
        }
        setPlayingSample({
          name: descriptor.name,
          bufSrc: playSample(descriptor, () => setPlayingSample(null)),
        });
      }
    },
    [playingSample, setPlayingSample]
  );

  useEffect(() => {
    if (!selectedSample) {
      return;
    }

    const handleKeydown = (evt: KeyboardEvent) => {
      if (evt.key === 'ArrowUp') {
        if (selectedSample.index === 0) {
          return;
        }

        togglePlaying(sampleDescriptors[selectedSample.index - 1]);
        setSelectedSample({
          sample: sampleDescriptors[selectedSample.index - 1],
          index: selectedSample.index - 1,
        });
      } else if (evt.key === 'ArrowDown') {
        if (selectedSample.index === sampleDescriptors.length - 1) {
          return;
        }

        togglePlaying(sampleDescriptors[selectedSample.index + 1]);
        setSelectedSample({
          sample: sampleDescriptors[selectedSample.index + 1],
          index: selectedSample.index + 1,
        });
      } else if (evt.key === ' ') {
        togglePlaying(selectedSample.sample);
      } else {
        return;
      }

      evt.preventDefault();
    };

    document.addEventListener('keydown', handleKeydown);

    return () => document.removeEventListener('keydown', handleKeydown);
  }, [sampleDescriptors, selectedSample, setSelectedSample, togglePlaying]);

  const RowRenderer = useMemo(() => {
    const mkRowRendererArgs: MkSampleListingRowRendererArgs = {
      sampleDescriptors,
      playingSample,
      togglePlaying,
      selectedSample,
      setSelectedSample,
    };

    return mkRowRenderer(mkRowRendererArgs);
  }, [
    sampleDescriptors,
    playingSample,
    togglePlaying,
    selectedSample,
    setSelectedSample,
    mkRowRenderer,
  ]);

  if (R.isEmpty(sampleDescriptors)) {
    return <>No available samples; no local or remote samples were found.</>;
  }

  return (
    <List
      height={height}
      rowHeight={20}
      rowCount={sampleDescriptors.length}
      width={width}
      rowRenderer={RowRenderer}
      scrollToIndex={selectedSample?.index}
    />
  );
}

export const LoadSamplesButtons: React.FC<
  {
    localSamplesLoaded: boolean;
    loadLocalSamples: () => void;
    remoteSamplesLoaded: boolean;
    loadRemoteSamples: () => void;
  } & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>
> = ({ localSamplesLoaded, loadLocalSamples, remoteSamplesLoaded, loadRemoteSamples, ...rest }) => (
  <div className='load-samples-buttons' {...rest}>
    {!localSamplesLoaded ? (
      <button style={{ width: 120 }} onClick={loadLocalSamples}>
        Load Local Samples
      </button>
    ) : null}
    {!remoteSamplesLoaded ? (
      <button style={{ width: 120 }} onClick={loadRemoteSamples}>
        Load Remote Samples
      </button>
    ) : null}
  </div>
);

const SampleLibraryUI: React.FC = () => {
  const {
    includeLocalSamples,
    setIncludeLocalSamples,
    includeRemoteSamples,
    setIncludeRemoteSamples,
    allSamples,
  } = useAllSamples();

  const [selectedSample, setSelectedSample] = useState<{
    sample: SampleDescriptor;
    index: number;
  } | null>(null);

  if (!Array.isArray(allSamples)) {
    return (
      <div className='sample-library'>
        <h1>Sample Library</h1>
        <Loading />
      </div>
    );
  }

  return (
    <div className='sample-library'>
      <h1>Sample Library</h1>

      <LoadSamplesButtons
        localSamplesLoaded={includeLocalSamples}
        loadLocalSamples={() => setIncludeLocalSamples(true)}
        remoteSamplesLoaded={includeRemoteSamples}
        loadRemoteSamples={() => setIncludeRemoteSamples(true)}
        style={{ marginBottom: 14 }}
      />

      <SampleListing
        selectedSample={selectedSample}
        setSelectedSample={setSelectedSample}
        sampleDescriptors={allSamples}
      />
    </div>
  );
};

export default SampleLibraryUI;
