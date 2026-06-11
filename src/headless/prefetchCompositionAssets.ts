/**
 * Kicks off fetches for AWP modules + wasm that the composition will need during init, overlapping
 * them with the rest of composition loading rather than waiting for each VC's init to request them.
 *
 * Detection is cheap substring matching on the raw serialized composition content; false positives
 * just warm assets that go unused.
 */
export const prefetchCompositionAssets = (content: string) => {
  if (content.includes('synthDesigner_') || content.includes('customAudio/fmSynth')) {
    void import('src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth').then(m =>
      m.prefetchFMSynthAssets()
    );
  }
  if (content.includes('equalizer_')) {
    void import('src/equalizer/EqualizerInstance').then(m => m.prefetchEqualizerAssets());
  }
  if (content.includes('customAudio/destination')) {
    void import('src/graphEditor/nodes/CustomAudio/Destination/CustomDestinationNode').then(m =>
      m.prefetchSafetyLimiterAssets()
    );
  }
  if (content.includes('customAudio/compressor')) {
    void import('src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode').then(m =>
      m.prefetchCompressorAssets()
    );
  }
};
