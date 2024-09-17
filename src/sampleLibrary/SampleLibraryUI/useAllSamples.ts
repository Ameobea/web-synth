import { parse as parsePath } from 'path-browserify';
import * as R from 'ramda';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'react-query';

import { listSamples, type SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';

const buildSampleDescriptorKey = (desc: SampleDescriptor): string =>
  `${desc.id ?? ''}${desc.isLocal}${desc.name}`;

const dedupSampleDescriptors = (descriptors: SampleDescriptor[]): SampleDescriptor[] => {
  const seenKeys = new Set();
  return descriptors.filter(desc => {
    const key = buildSampleDescriptorKey(desc);
    const exists = seenKeys.has(key);
    if (exists) {
      return false;
    }
    seenKeys.add(key);
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

  return {
    includeLocalSamples,
    setIncludeLocalSamples,
    allSamples,
  };
};

export default useAllSamples;
