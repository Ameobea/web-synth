import { useEffect, useRef, useState } from 'react';

import { SampleDescriptor, listSamples } from 'src/sampleLibrary/sampleLibrary';

export const useAllSamples = () => {
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

    console.log('fetching', includeLocalSamples);
    setAllSamples('FETCHING');
    listSamples({ includeLocal: includeLocalSamples, includeRemote: true })
      .then(setAllSamples)
      .catch(err => {
        console.error('Failed to list all samples: ', err);
        setAllSamples('FETCH_ERROR');
      });
  }, [includeLocalSamples, allSamples]);

  return { includeLocalSamples, setIncludeLocalSamples, allSamples };
};

export default useAllSamples;
