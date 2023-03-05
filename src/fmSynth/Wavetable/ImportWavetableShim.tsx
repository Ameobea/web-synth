import React, { Suspense } from 'react';

import type { UploadWavetableModalProps } from 'src/fmSynth/Wavetable/UploadWavetable';

const LazyUploadWavetableModal = React.lazy(() =>
  import('src/fmSynth/Wavetable/UploadWavetable').then(mod => ({
    default: mod.mkUploadWavetableModal([]),
  }))
);
export const WrappedUploadWavetableModal: React.FC<UploadWavetableModalProps> = props => (
  <Suspense fallback={<>Loading...</>}>
    <LazyUploadWavetableModal {...props} />
  </Suspense>
);
