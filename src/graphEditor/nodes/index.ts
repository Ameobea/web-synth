import * as R from 'ramda';

import { getState } from 'src/redux';
import { fetchEffects } from 'src/controls/EffectPicker';
import { registerFaustNode } from './Faust';
import { registerAudioConnectablesNode } from 'src/graphEditor/nodes/AudioConnectablesNode';
import { registerCustomAudioNodes } from 'src/graphEditor/nodes/CustomAudio';

/**
 * Registers all custom node types so that they can be used with the graph editor
 */
export const registerAllCustomNodes = R.once(async () => {
  // Fetch the list of all available Faust modules if we don't have it loaded
  let availableModules:
    | {
        id: number;
        title: string;
        description: string;
        code: string;
      }[]
    | undefined = getState().effects.sharedEffects;

  if (availableModules) {
    availableModules = await fetchEffects();
  }

  registerFaustNode(availableModules);
  registerAudioConnectablesNode();
  registerCustomAudioNodes();
});
