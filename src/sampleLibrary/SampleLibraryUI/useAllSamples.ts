import { parse as parsePath } from 'path-browserify';
import * as R from 'ramda';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'react-query';

import {
  hashSampleDescriptor,
  listSamples,
  type SampleDescriptor,
} from 'src/sampleLibrary/sampleLibrary';

const dedupSampleDescriptors = (descriptors: SampleDescriptor[]): SampleDescriptor[] => {
  const seen = new Set<string>();
  return descriptors.filter(desc => {
    const key = hashSampleDescriptor(desc);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const getSampleDisplayName = (descriptor: SampleDescriptor) => {
  try {
    const parsed = parsePath(descriptor.name);
    return parsed.name;
  } catch (_err) {
    return descriptor.name;
  }
};

export const useAllSamples = () => {
  const [cachedSamples, setCachedSamples] = useState<SampleDescriptor[] | 'FETCHING' | null>(null);
  const [localSamples, setLocalSamples] = useState<
    SampleDescriptor[] | null | 'FETCHING' | 'FETCH_ERROR'
  >(null);
  const { data: remoteSamples } = useQuery(
    'remoteSamples',
    () => listSamples({ includeRemote: true }),
    { refetchOnWindowFocus: false }
  );
  const [includeLocalSamples, setIncludeLocalSamples] = useState(false);

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
  }, [includeLocalSamples, localSamples, remoteSamples, cachedSamples]);

  const allSamples = useMemo(
    () =>
      R.sortWith(
        [R.ascend(getSampleDisplayName), R.ascend(R.prop('isLocal'))],
        dedupSampleDescriptors([
          ...(includeLocalSamples && localSamples && typeof localSamples !== 'string'
            ? localSamples
            : []),
          ...(remoteSamples ? remoteSamples : []),
          ...(cachedSamples && typeof cachedSamples !== 'string' ? cachedSamples : []),
        ])
      ),
    [includeLocalSamples, localSamples, remoteSamples, cachedSamples]
  );

  const cachedHashes = useMemo(
    () =>
      new Set(
        cachedSamples && typeof cachedSamples !== 'string'
          ? cachedSamples.map(hashSampleDescriptor)
          : []
      ),
    [cachedSamples]
  );

  return {
    includeLocalSamples,
    setIncludeLocalSamples,
    allSamples,
    cachedHashes,
  };
};

export default useAllSamples;
