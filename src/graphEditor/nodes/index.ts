import * as R from 'ramda';

import { registerAudioConnectablesNode } from 'src/graphEditor/nodes/AudioConnectablesNode';
import { registerCustomAudioNodes } from 'src/graphEditor/nodes/CustomAudio';

/**
 * Registers all custom node types so that they can be used with the graph editor
 */
export const registerAllCustomNodes = R.once(async () => {
  registerAudioConnectablesNode();
  registerCustomAudioNodes();
});
