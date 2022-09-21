import * as R from 'ramda';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';

import './SampleLibraryUI.scss';
import useAllSamples, { getSampleDisplayName } from './useAllSamples';
import Loading from 'src/misc/Loading';
import { getIsSampleCached } from 'src/sampleLibrary/sampleCache';
import { getSample, SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';

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
  const parsedName = getSampleDisplayName(descriptor);
  const [isCached, setIsCached] = useState<string>('?');
  useEffect(() => {
    getIsSampleCached(descriptor).then(isCached => setIsCached(isCached ? 'Yes' : 'No'));
  }, [descriptor]);

  return (
    <div className='sample-row' {...rest} style={style}>
      <PlaySampleIcon isPlaying={isPlaying} onClick={togglePlaying} />
      <div className='sample-name' title={descriptor.name}>
        {parsedName}
      </div>
      <div className='sample-local'>{descriptor.isLocal ? 'Local' : 'Remote'}</div>
      <div className='sample-cached'>{isCached}</div>
    </div>
  );
};

export interface MkSampleListingRowRendererArgs {
  sampleDescriptors: SampleDescriptor[];
  playingSampleName: string | null;
  togglePlaying: (descriptor: SampleDescriptor) => void;
  selectedSample: { sample: SampleDescriptor; index: number } | null;
  setSelectedSample: (
    newSelectedSample: { sample: SampleDescriptor; index: number } | null
  ) => void;
}

const mkDefaultSampleListingRowRenderer = ({
  sampleDescriptors,
  playingSampleName,
  togglePlaying,
}: MkSampleListingRowRendererArgs): React.FC<ListChildComponentProps> => {
  const DefaultSampleListingRowRenderer: React.FC<ListChildComponentProps> = ({ style, index }) => (
    <SampleRow
      togglePlaying={() => togglePlaying(sampleDescriptors[index])}
      isPlaying={sampleDescriptors[index].name === playingSampleName}
      descriptor={sampleDescriptors[index]}
      style={style}
    />
  );
  return DefaultSampleListingRowRenderer;
};

const ctx = new AudioContext();

const buildSampleBufferSourceNode = async (
  descriptor: SampleDescriptor,
  onFinished: () => void
): Promise<AudioBufferSourceNode> => {
  const buffer = await getSample(descriptor);
  const bufSrc = new AudioBufferSourceNode(ctx);
  bufSrc.buffer = buffer;
  bufSrc.connect((ctx as any).globalVolume);
  bufSrc.onended = onFinished;

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

class PlayingSampleManager {
  private setPlayingSampleName: (name: string | null) => void;
  private playingSampleDescriptor: SampleDescriptor | null = null;
  private playingSample: AudioBufferSourceNode | null = null;

  constructor(setPlayingSampleName: (name: string | null) => void) {
    this.setPlayingSampleName = setPlayingSampleName;
  }

  private startPlaying = (desc: SampleDescriptor) => {
    this.playingSampleDescriptor = desc;
    this.setPlayingSampleName(desc.name);
    buildSampleBufferSourceNode(desc, () => {
      if (this.playingSampleDescriptor?.name === desc.name) {
        this.playingSample = null;
        this.setPlayingSampleName(null);
      }
    }).then(bufSrc => {
      // If the playing sample has changed before we fetched this, don't start playing it
      if (this.playingSampleDescriptor?.name !== desc.name) {
        return;
      }
      bufSrc.start();
      if (this.playingSample) {
        console.error('Invariant violation; playing sample buffer was set before fetch completed');
        this.playingSample.stop();
      }
      this.playingSample = bufSrc;
    });
  };

  public togglePlaying(desc: SampleDescriptor) {
    this.playingSample?.stop();
    this.playingSample = null;

    if (desc.name === this.playingSampleDescriptor?.name) {
      this.playingSampleDescriptor = null;
      return;
    }

    this.startPlaying(desc);
  }

  public dispose() {
    this.playingSample?.stop();
    this.playingSample = null;
    this.playingSampleDescriptor = null;
  }
}

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
  const [playingSampleName, setPlayingSampleName] = useState<string | null>(null);
  const playingSampleManager = useRef(new PlayingSampleManager(setPlayingSampleName));

  useEffect(() => () => playingSampleManager.current.dispose(), []);

  const [sampleSearch, setSampleSearch] = useState('');
  const lowerSampleSearch = sampleSearch.toLowerCase();
  const filteredSamples = useMemo(
    () =>
      sampleSearch
        ? sampleDescriptors.filter(sample => sample.name.toLowerCase().includes(lowerSampleSearch))
        : sampleDescriptors,
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

        playingSampleManager.current.togglePlaying(filteredSamples[selectedSample.index - 1]);
        setSelectedSample({
          sample: filteredSamples[selectedSample.index - 1],
          index: selectedSample.index - 1,
        });
      } else if (evt.key === 'ArrowDown') {
        if (selectedSample.index === filteredSamples.length - 1) {
          return;
        }

        playingSampleManager.current.togglePlaying(filteredSamples[selectedSample.index + 1]);
        setSelectedSample({
          sample: filteredSamples[selectedSample.index + 1],
          index: selectedSample.index + 1,
        });
      } else if (evt.key === ' ') {
        playingSampleManager.current.togglePlaying(selectedSample.sample);
      } else {
        return;
      }

      evt.preventDefault();
    };

    document.addEventListener('keydown', handleKeydown);

    return () => document.removeEventListener('keydown', handleKeydown);
  }, [filteredSamples, selectedSample, setSelectedSample]);

  const RowRenderer = useMemo(
    () =>
      mkRowRenderer({
        sampleDescriptors: filteredSamples,
        playingSampleName,
        togglePlaying: playingSampleManager.current.togglePlaying.bind(
          playingSampleManager.current
        ),
        selectedSample,
        setSelectedSample,
      }),
    [filteredSamples, playingSampleName, selectedSample, setSelectedSample, mkRowRenderer]
  );

  if (R.isEmpty(sampleDescriptors)) {
    return <>No available samples; no local or remote samples were found.</>;
  }

  return (
    <>
      <SampleSearch value={sampleSearch} onChange={setSampleSearch} />
      <div className='sample-row' style={{ width: '100%', borderBottom: '1px solid #888' }}>
        <div />
        <div className='sample-name'>Name</div>
        <div className='sample-local'>Location</div>
        <div className='sample-cached'>Cached</div>
      </div>
      <List height={height} itemSize={20} itemCount={filteredSamples.length} width={width}>
        {RowRenderer}
      </List>
    </>
  );
};

interface LoadSamplesButtonsProps
  extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  localSamplesLoaded: boolean;
  loadLocalSamples: () => void;
}

export const LoadSamplesButtons: React.FC<LoadSamplesButtonsProps> = ({
  localSamplesLoaded,
  loadLocalSamples,
  ...rest
}) => (
  <div className='load-samples-buttons' {...rest}>
    {!localSamplesLoaded ? (
      <button style={{ width: 120 }} onClick={loadLocalSamples}>
        Load Local Samples
      </button>
    ) : null}
  </div>
);

const SampleLibraryUI: React.FC = () => {
  const { includeLocalSamples, setIncludeLocalSamples, allSamples } = useAllSamples();

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
