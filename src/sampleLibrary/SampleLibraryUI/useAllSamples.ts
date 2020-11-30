import { useEffect, useMemo, useState } from 'react';

import { SampleDescriptor, listSamples } from 'src/sampleLibrary/sampleLibrary';

export const useAllSamples = () => {
  const [cachedSamples, setCachedSamples] = useState<SampleDescriptor[] | 'FETCHING' | null>(null);
  const [localSamples, setLocalSamples] = useState<
    SampleDescriptor[] | null | 'FETCHING' | 'FETCH_ERROR'
  >(null);
  const [remoteSamples, setRemoteSamples] = useState<
    SampleDescriptor[] | null | 'FETCHING' | 'FETCH_ERROR'
  >(null);
  const [includeLocalSamples, setIncludeLocalSamples] = useState(false);
  const [includeRemoteSamples, setIncludeRemoteSamples] = useState(false);

  useEffect(() => {
    if (!cachedSamples) {
      setCachedSamples('FETCHING');
      new Promise(async () => setCachedSamples(await listSamples({ includeCached: true })));
    }
    if (includeLocalSamples && !localSamples) {
      setLocalSamples('FETCHING');
      new Promise(async () => {
        try {
          setLocalSamples(await listSamples({ includeLocal: true }));
        } catch (err) {
          console.error('Error fetching local samples: ', err);
          setLocalSamples('FETCH_ERROR');
        }
      });
    }
    if (includeRemoteSamples && !remoteSamples) {
      setRemoteSamples('FETCHING');
      new Promise(async () => {
        try {
          setRemoteSamples(await listSamples({ includeRemote: true }));
        } catch (err) {
          console.error('Error fetching remote samples: ', err);
          setRemoteSamples('FETCH_ERROR');
        }
      });
    }
  }, [includeLocalSamples, includeRemoteSamples, localSamples, remoteSamples, cachedSamples]);

  const allSamples = useMemo(
    () => [
      ...(includeLocalSamples && localSamples && typeof localSamples !== 'string'
        ? localSamples
        : []),
      ...(includeRemoteSamples && remoteSamples && typeof remoteSamples !== 'string'
        ? remoteSamples
        : []),
      ...(cachedSamples && typeof cachedSamples !== 'string' ? cachedSamples : []),
    ],
    [includeLocalSamples, localSamples, includeRemoteSamples, remoteSamples, cachedSamples]
  );

  return {
    includeLocalSamples,
    setIncludeLocalSamples,
    includeRemoteSamples,
    setIncludeRemoteSamples,
    allSamples,
  };
};

export default useAllSamples;
