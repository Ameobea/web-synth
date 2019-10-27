import { Map } from 'immutable';
import { UnimplementedError } from 'ameo-utils';
import { LiteGraph } from 'litegraph.js';

import { AudioConnectables, addNode } from 'src/patchNetwork';
import { LGAudioConnectables } from './AudioConnectablesNode';

/**
 * Registers custom versions of the LiteGraph audio nodes.  These are special because their inner `AudioNode`s and `AudioParam`s
 * are managed outside of the mode - connecting them in LiteGraph is a no-op.  Connections between these nodes are managed
 * at the patch network level.
 */

export type ForeignNode = GainNode | ConstantSourceNode | BiquadFilterNode;

export const buildConnectablesForNode = (node: ForeignNode, id: string): AudioConnectables => {
  if (node instanceof GainNode) {
    return {
      vcId: id,
      inputs: Map<string, AudioParam | AudioNode>(
        Object.entries({
          input: node,
          gain: node.gain,
        })
      ),
      outputs: Map<string, AudioNode>().set('output', node),
      node,
    };
  } else if (node instanceof ConstantSourceNode) {
    return {
      vcId: id,
      inputs: Map<string, AudioParam | AudioNode>().set('offset', node.offset),
      outputs: Map<string, AudioNode>().set('offset', node),
      node,
    };
  } else if (node instanceof BiquadFilterNode) {
    return {
      vcId: id,
      inputs: Map<string, AudioParam | AudioNode>(
        Object.entries({
          frequency: node.frequency,
          Q: node.Q,
          detune: node.detune,
          gain: node.gain,
        })
      ),
      outputs: Map<string, AudioNode>().set('output', node),
      node,
    };
  } else {
    throw new UnimplementedError(`Node not yet supported: ${node}`);
  }
};

const ctx = new AudioContext();

export const audioNodeGetters: { [type: string]: () => ForeignNode } = {
  'customAudio/gain': () => new GainNode(ctx),
  'customAudio/biquadFilter': () => new BiquadFilterNode(ctx),
  'customAudio/constantSource': () => {
    const csn = new ConstantSourceNode(ctx);
    csn.start();
    return csn;
  },
};

export const getDisplayNameByForeignNodeType = (foreignNodeType: string): string => {
  const displayNameByForeignNodeType: { [key: string]: string } = {
    'customAudio/gain': 'Gain',
    'customAudio/biquadFilter': 'Biquad Filter',
    'customAudio/constantSource': 'Constant Source',
  };

  const displayName = displayNameByForeignNodeType[foreignNodeType];
  if (!displayName) {
    console.error(`No display name for foreign node of type ${foreignNodeType}`);
    return 'Unknown';
  }
  return displayName;
};

export const getForeignNodeType = (foreignNode: ForeignNode) => {
  if (foreignNode instanceof GainNode) {
    return 'customAudio/gain';
  } else if (foreignNode instanceof BiquadFilterNode) {
    return 'customAudio/biquadFilter';
  } else if (foreignNode instanceof ConstantSourceNode) {
    return 'customAudio/constantSource';
  } else {
    throw new UnimplementedError(`Unable to get node type of unknown foreign node: ${foreignNode}`);
  }
};

const registerCustomAudioNode = (type: string, nodeGetter: () => ForeignNode) => {
  function CustomAudioNode(this: any) {
    // Default Properties
    this.properties = {};
    this.title = type;

    this.ctx = new AudioContext();

    const node = nodeGetter();
    const connectables = buildConnectablesForNode(node, this.id);

    // Create empty placeholder connectables
    this.connectables = connectables;

    [...connectables.inputs.entries()].forEach(([name, input]) => {
      if (input instanceof AudioParam) {
        console.log(name, input);
        this.addProperty(name, input.value, 'number');
        this.addInput(name, 'number');
      } else {
        // TODO: Look up this type dynamically?
        this.addInput(name, 'audio');
      }
    });

    [...connectables.outputs.entries()].forEach(([name, _output]) => {
      // TODO: Look up this type dynamically?
      this.addOutput(name, 'audio');
    });
  }

  CustomAudioNode.prototype.onAdded = function(this: any) {
    this.connectables.vcId = this.id.toString();
    addNode(this.id.toString(), this.connectables);
  };

  CustomAudioNode.prototype.onPropertyChanged = LGAudioConnectables.prototype.onPropertyChanged;
  CustomAudioNode.prototype.onConnectionsChange = LGAudioConnectables.prototype.onConnectionsChange;

  LiteGraph.registerNodeType(type, CustomAudioNode);
};

export const registerCustomAudioNodes = () =>
  Object.entries(audioNodeGetters).forEach(([type, nodeGetter]) =>
    registerCustomAudioNode(type, nodeGetter)
  );
