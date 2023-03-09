import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { mkSvelteComponentShim } from 'src/svelteUtils';
import NativeCompressorSmallView from './NativeCompressorSmallView.svelte';

interface NativeCompressorSmallViewShimProps {
  node: ForeignNode<DynamicsCompressorNode>;
}

export const NativeCompressorSmallViewShim = mkSvelteComponentShim(
  NativeCompressorSmallView as any
) as unknown as React.FC<NativeCompressorSmallViewShimProps>;
