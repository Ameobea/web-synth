import React, { useState, useEffect } from 'react';
import { SampleDescriptor, listSamples } from 'src/sampleLibrary/sampleLibrary';
import Loading from 'src/misc/Loading';

const SampleLibraryUI: React.FC<{}> = () => {
  const [allSamples, setAllSamples] = useState<
    SampleDescriptor[] | null | 'FETCHING' | 'FETCH_ERROR'
  >(null);

  useEffect(() => {
    if (allSamples !== null) {
      return;
    }

    listSamples()
      .then(setAllSamples)
      .catch(err => {
        console.error('Failed to list all samples: ', err);
        setAllSamples('FETCH_ERROR');
      });
  }, [allSamples]);

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
    </div>
  );
};

export default SampleLibraryUI;
