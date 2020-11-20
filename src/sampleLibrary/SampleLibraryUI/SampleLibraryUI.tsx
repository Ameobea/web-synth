import React, { useState, useMemo } from 'react';
import * as R from 'ramda';
import { List, ListRowRenderer } from 'react-virtualized';

import { SampleDescriptor, getSample } from 'src/sampleLibrary/sampleLibrary';
import Loading from 'src/misc/Loading';
import useAllSamples from './useAllSamples';
import './SampleLibraryUI.scss';
import { UnimplementedError } from 'ameo-utils';

const ctx = new AudioContext();

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
    {descriptor.name}
  </div>
);

const playSample = async (descriptor: SampleDescriptor): Promise<AudioBufferSourceNode> => {
  const buffer = await getSample(descriptor);
  console.log({ buffer });
  const bufSrc = new AudioBufferSourceNode(ctx);
  bufSrc.buffer = buffer;
  bufSrc.connect(ctx.destination);
  bufSrc.start();

  return bufSrc;
};

export interface MkDefaultSampleListingRowRendererArgs {
  sampleDescriptors: SampleDescriptor[];
  playingSample: {
    name: string;
    bufSrc: Promise<AudioBufferSourceNode>;
  } | null;
  togglePlaying: (descriptor: SampleDescriptor) => void;
}

const mkDefaultSampleListingRowRenderer = ({
  sampleDescriptors,
  playingSample,
  togglePlaying,
}: MkDefaultSampleListingRowRendererArgs): ListRowRenderer => {
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

export function SampleListing<ExtraMkRowRendererArgs extends { [key: string]: any } = {}>({
  sampleDescriptors,
  mkRowRenderer = mkDefaultSampleListingRowRenderer,
  extraMkRowRendererArgs,
  height = 800,
  width = 500,
}: {
  sampleDescriptors: SampleDescriptor[];
  mkRowRenderer?: ({
    sampleDescriptors,
    playingSample,
    togglePlaying,
  }: MkDefaultSampleListingRowRendererArgs & ExtraMkRowRendererArgs) => ListRowRenderer;
  extraMkRowRendererArgs: ExtraMkRowRendererArgs;
  height?: number;
  width?: number;
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
        setPlayingSample({ name: descriptor.name, bufSrc: playSample(descriptor) });
      }
    },
    [playingSample, setPlayingSample]
  );

  const RowRenderer = useMemo(() => {
    const mkRowRendererArgs: MkDefaultSampleListingRowRendererArgs & ExtraMkRowRendererArgs = {
      sampleDescriptors,
      playingSample,
      togglePlaying,
      ...(extraMkRowRendererArgs || {}),
    };

    return mkRowRenderer(mkRowRendererArgs);
  }, [sampleDescriptors, playingSample, togglePlaying, mkRowRenderer, extraMkRowRendererArgs]);

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
  const { includeLocalSamples, setIncludeLocalSamples, allSamples } = useAllSamples();

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
        remoteSamplesLoaded={false}
        loadRemoteSamples={() => {
          throw new UnimplementedError(); // TODO
        }}
      />

      <SampleListing extraMkRowRendererArgs={{}} sampleDescriptors={allSamples} />
    </div>
  );
};

export default SampleLibraryUI;
