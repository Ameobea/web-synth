/**
 * Defines a graph node that wraps an `AudioConnectables` instance.  It
 */

import { LiteGraph } from 'litegraph.js';

import {
  AudioConnectables,
  create_empty_audio_connectables,
  ConnectableDescriptor,
} from 'src/patchNetwork';
import {
  LiteGraphNodeInput,
  LiteGraphLink,
  LiteGraph as LiteGraphType,
} from 'src/graphEditor/LiteGraphTypes';
import { dispatch, actionCreators } from 'src/redux';

export function LGAudioConnectables(this: any) {
  // Default Properties
  this.properties = {};

  this.ctx = new AudioContext();

  // Create empty placeholder connectables
  // this.connectables = create_empty_audio_connectables(this.id.toString());
}

LGAudioConnectables.prototype.setConnectables = function(
  this: any,
  connectables: AudioConnectables
) {
  // Store the raw inputs and outputs for later direct access
  this.connectables = connectables;

  [...connectables.inputs.entries()].forEach(([name, input]) => {
    if (input instanceof AudioParam) {
      this.addProperty(name, input.value, 'number');
    } else {
      this.addInput(name, 'audio');
    }
  });

  [...connectables.outputs.entries()].forEach(([name, _output]) => {
    // TODO: Look up this type dynamically?
    this.addOutput(name, 'audio');
  });
};

LGAudioConnectables.prototype.onPropertyChanged = function(name: string, value: any) {
  const node = (this.connectables as AudioConnectables).inputs.get(name);
  if (!node) {
    console.error(`No input named "${name}" found on connectables for node`);
    return;
  } else if (!(node instanceof AudioParam)) {
    console.error(`Input named "${name}" is not an instance of \`AudioParam\``);
    return;
  }

  node.setValueAtTime(value, (this.ctx as AudioContext).currentTime);
};

LGAudioConnectables.prototype.onConnectionsChange = function(
  this: { graph: LiteGraphType },
  _connection: 1 | 2,
  _slot: number,
  isNowConnected: boolean,
  linkInfo: LiteGraphLink,
  _inputInfo: LiteGraphNodeInput
) {
  const srcNode = this.graph._nodes_by_id[linkInfo.origin_id];
  if (!srcNode) {
    console.error(`Cannot find node id ${linkInfo.origin_id}`, linkInfo);
  }
  const srcOutput = srcNode.outputs[linkInfo.origin_slot];
  if (!srcOutput) {
    console.error(
      `No output with index ${linkInfo.origin_slot} on node with id ${linkInfo.origin_id}`,
      linkInfo
    );
  }

  const dstNode = this.graph._nodes_by_id[linkInfo.target_id];
  if (!dstNode) {
    console.error(`Cannot find node id ${linkInfo.target_id}`, linkInfo);
  }
  const dstInput = dstNode.inputs[linkInfo.target_slot];
  if (!dstInput) {
    console.error(
      `No input with index ${linkInfo.target_slot} on node with id ${linkInfo.target_id}`,
      linkInfo
    );
  }

  const from: ConnectableDescriptor = { vcId: linkInfo.origin_id.toString(), name: srcOutput.name };
  const to: ConnectableDescriptor = { vcId: linkInfo.target_id.toString(), name: dstInput.name };

  // Dispatch a Redux action to trigger the patch network to be updated.  This will return a new Patch network and in turn
  // cause litegraph to be updated as well later.
  const actionCreator = isNowConnected
    ? actionCreators.viewContextManager.CONNECT
    : actionCreators.viewContextManager.DISCONNECT;
  dispatch(actionCreator(from, to));
};

export const registerAudioConnectablesNode = () =>
  LiteGraph.registerNodeType('audio/audioConnectables', LGAudioConnectables);
