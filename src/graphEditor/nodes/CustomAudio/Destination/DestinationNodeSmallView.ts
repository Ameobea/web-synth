import type { CustomAudioDestinationNode, ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { mkSvelteComponentShim } from 'src/svelteUtils';
import DestinationNodeSmallView from './DestinationNodeSmallView.svelte';

interface DestinationNodeSmallViewProps {
  node: ForeignNode<CustomAudioDestinationNode>;
}

export const DestinationNodeSmallViewShim = mkSvelteComponentShim(
  DestinationNodeSmallView as any
) as unknown as React.FC<DestinationNodeSmallViewProps>;
