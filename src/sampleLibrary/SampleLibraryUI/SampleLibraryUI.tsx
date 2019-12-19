import React, { useState, useRef, useEffect } from 'react';
import * as R from 'ramda';
import { List } from 'react-virtualized';

import { SampleDescriptor, listSamples, getSample } from 'src/sampleLibrary/sampleLibrary';
import Loading from 'src/misc/Loading';
import './SampleLibraryUI.scss';

const ctx = new AudioContext();

const PlaySampleIcon: React.FC<{
  onClick: () => void;
  isPlaying: boolean;
}> = ({ isPlaying, onClick }) => (
  <div className='play-sample-icon' onClick={onClick}>
    {isPlaying ? '■' : '▶'}
  </div>
);

const SampleRow: React.FC<{
  isPlaying: boolean;
  togglePlaying: () => void;
  descriptor: SampleDescriptor;
  style?: React.CSSProperties;
}> = ({ descriptor, style, togglePlaying, isPlaying }) => (
  <div className='sample-row' style={style}>
    <PlaySampleIcon isPlaying={isPlaying} onClick={togglePlaying} />
    {descriptor.name}
  </div>
);

const playSample = async (descriptor: SampleDescriptor): Promise<AudioBufferSourceNode> => {
  const buffer = await getSample(descriptor);
  const bufSrc = new AudioBufferSourceNode(ctx);
  bufSrc.buffer = buffer;
  bufSrc.connect(ctx.destination);
  bufSrc.start();

  return bufSrc;
};

const SampleListing: React.FC<{
  sampleDescriptors: SampleDescriptor[];
}> = ({ sampleDescriptors }) => {
  const [playingSample, setPlayingSample] = useState<{
    name: string;
    bufSrc: Promise<AudioBufferSourceNode>;
  } | null>(null);

  if (R.isEmpty(sampleDescriptors)) {
    return <>No available samples; no local or remote samples were found.</>;
  }

  const togglePlaying = (descriptor: SampleDescriptor) => {
    if (playingSample?.name === descriptor.name) {
      if (playingSample) {
        playingSample.bufSrc.then(bufSrc => bufSrc.stop());
      }
      setPlayingSample(null);
    } else {
      if (playingSample !== null) {
        playingSample.bufSrc.then(bufSrc => bufSrc.stop());
      }
      setPlayingSample({ name, bufSrc: playSample(descriptor) });
    }
  };

  return (
    <List
      height={800}
      rowHeight={20}
      rowCount={sampleDescriptors.length}
      width={500}
      rowRenderer={({ style, index, key }) => (
        <SampleRow
          togglePlaying={() => togglePlaying(sampleDescriptors[index])}
          isPlaying={sampleDescriptors[index].name === playingSample?.name}
          descriptor={sampleDescriptors[index]}
          key={key}
          style={style}
        />
      )}
    />
  );
};

const SampleLibraryUI: React.FC<{}> = () => {
  const [allSamples, setAllSamples] = useState<
    SampleDescriptor[] | null | 'FETCHING' | 'FETCH_ERROR'
  >(null);
  const [includeLocalSamples, setIncludeLocalSamples] = useState(false);

  const lastIncludeLocalSamples = useRef(false);
  useEffect(() => {
    if ((['FETCHING', 'FETCH_ERROR'] as typeof allSamples[]).includes(allSamples)) {
      return;
    } else if (
      Array.isArray(allSamples) &&
      lastIncludeLocalSamples.current === includeLocalSamples
    ) {
      return;
    }

    lastIncludeLocalSamples.current = includeLocalSamples;

    setAllSamples('FETCHING');
    listSamples({ includeLocal: includeLocalSamples, includeRemote: true })
      .then(setAllSamples)
      .catch(err => {
        console.error('Failed to list all samples: ', err);
        setAllSamples('FETCH_ERROR');
      });
  }, [includeLocalSamples, allSamples]);

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

      {!includeLocalSamples ? (
        <button style={{ width: 120 }} onClick={() => setIncludeLocalSamples(true)}>
          Load Local Samples
        </button>
      ) : null}

      <SampleListing sampleDescriptors={allSamples} />
    </div>
  );
};

export default SampleLibraryUI;
