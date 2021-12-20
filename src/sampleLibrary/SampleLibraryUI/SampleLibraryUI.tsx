import React, { useEffect, useMemo, useState } from 'react';
import * as R from 'ramda';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { parse as parsePath } from 'path-browserify';

import { getSample, SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
import Loading from 'src/misc/Loading';
import useAllSamples from './useAllSamples';
import './SampleLibraryUI.scss';

interface PlaySampleIconProps {
  onClick: () => void;
  isPlaying: boolean;
}

const PlaySampleIcon: React.FC<PlaySampleIconProps> = ({ isPlaying, onClick }) => (
  <div className='play-sample-icon' onClick={onClick}>
    {isPlaying ? '■' : '▶'}
  </div>
);

interface SampleRowProps
  extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  isPlaying: boolean;
  togglePlaying: () => void;
  descriptor: SampleDescriptor;
  style?: React.CSSProperties;
}

export const SampleRow: React.FC<SampleRowProps> = ({
  descriptor,
  style,
  togglePlaying,
  isPlaying,
  ...rest
}) => {
  const parsedName = (() => {
    try {
      const parsed = parsePath(descriptor.name);
      return parsed.name;
    } catch (err) {
      return descriptor.name;
    }
  })();

  return (
    <div className='sample-row' {...rest} style={style}>
      <PlaySampleIcon isPlaying={isPlaying} onClick={togglePlaying} />
      <span title={descriptor.name}>{parsedName}</span>
    </div>
  );
};

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
}: MkSampleListingRowRendererArgs): React.FC<ListChildComponentProps> => {
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

interface SampleSearchProps {
  value: string;
  onChange: (newVal: string) => void;
}

const SampleSearch: React.FC<SampleSearchProps> = ({ value, onChange }) => (
  <div className='sample-search'>
    Search Samples
    <input value={value} onChange={evt => onChange(evt.target.value)} />
  </div>
);

interface SampleListingProps {
  sampleDescriptors: SampleDescriptor[];
  mkRowRenderer?: (args: MkSampleListingRowRendererArgs) => React.FC<ListChildComponentProps>;
  height?: number;
  width?: number;
  selectedSample: { sample: SampleDescriptor; index: number } | null;
  setSelectedSample: (
    newSelectedSample: { sample: SampleDescriptor; index: number } | null
  ) => void;
}

export const SampleListing: React.FC<SampleListingProps> = ({
  sampleDescriptors,
  mkRowRenderer = mkDefaultSampleListingRowRenderer,
  height = 800,
  width = 500,
  selectedSample,
  setSelectedSample,
}) => {
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

  const [sampleSearch, setSampleSearch] = useState('');
  const lowerSampleSearch = sampleSearch.toLowerCase();
  const filteredSamples = useMemo(
    () =>
      typeof sampleDescriptors === 'string'
        ? []
        : (sampleDescriptors || []).filter(sample => {
            if (!sampleSearch) {
              return true;
            }

            return sample.name.toLowerCase().includes(lowerSampleSearch);
          }),
    [sampleDescriptors, lowerSampleSearch, sampleSearch]
  );
  useEffect(() => {
    if (!selectedSample) {
      return;
    }

    for (let i = 0; i < filteredSamples.length; i++) {
      const sample = filteredSamples[i];
      // Update selected sample to make sure index matches if it's still in the filtered set, otherwise
      // deselect it if it's been filtered out
      if (selectedSample.sample.id !== sample.id || selectedSample.sample.name !== sample.name) {
        return;
      }

      if (selectedSample.index !== i) {
        setSelectedSample({ sample: selectedSample.sample, index: i });
      }
      return;
    }

    // Selected sample has been filtered out
    setSelectedSample(null);
  }, [filteredSamples, selectedSample, setSelectedSample]);

  useEffect(() => {
    if (!selectedSample) {
      return;
    }

    const handleKeydown = (evt: KeyboardEvent) => {
      if (evt.key === 'ArrowUp') {
        if (selectedSample.index === 0) {
          return;
        }

        togglePlaying(filteredSamples[selectedSample.index - 1]);
        setSelectedSample({
          sample: filteredSamples[selectedSample.index - 1],
          index: selectedSample.index - 1,
        });
      } else if (evt.key === 'ArrowDown') {
        if (selectedSample.index === filteredSamples.length - 1) {
          return;
        }

        togglePlaying(filteredSamples[selectedSample.index + 1]);
        setSelectedSample({
          sample: filteredSamples[selectedSample.index + 1],
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
  }, [filteredSamples, selectedSample, setSelectedSample, togglePlaying]);

  const RowRenderer = useMemo(() => {
    const mkRowRendererArgs: MkSampleListingRowRendererArgs = {
      sampleDescriptors: filteredSamples,
      playingSample,
      togglePlaying,
      selectedSample,
      setSelectedSample,
    };

    return mkRowRenderer(mkRowRendererArgs);
  }, [
    filteredSamples,
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
    <>
      <SampleSearch value={sampleSearch} onChange={setSampleSearch} />
      <List
        height={height}
        itemSize={20}
        itemCount={filteredSamples.length}
        width={width}
        // scrollToIndex={selectedSample?.index} // TODO
      >
        {RowRenderer}
      </List>
    </>
  );
};

interface LoadSamplesButtonsProps
  extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  localSamplesLoaded: boolean;
  loadLocalSamples: () => void;
  remoteSamplesLoaded: boolean;
  loadRemoteSamples: () => void;
}

export const LoadSamplesButtons: React.FC<LoadSamplesButtonsProps> = ({
  localSamplesLoaded,
  loadLocalSamples,
  remoteSamplesLoaded,
  loadRemoteSamples,
  ...rest
}) => (
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
