import { Map } from 'immutable';
import { UnimplementedError } from 'ameo-utils';
import { LiteGraph } from 'litegraph.js';

import { AudioConnectables, addNode, removeNode } from 'src/patchNetwork';
import { LGAudioConnectables } from '../AudioConnectablesNode';
import { micNode, MicNode } from 'src/graphEditor/nodes/CustomAudio/audioUtils';

/**
 * Registers custom versions of the LiteGraph audio nodes.  These are special because their inner `AudioNode`s and `AudioParam`s
 * are managed outside of the mode - connecting them in LiteGraph is a no-op.  Connections between these nodes are managed
 * at the patch network level.
 */

export type ForeignNode =
  | GainNode
  | ConstantSourceNode
  | BiquadFilterNode
  | AudioBufferSourceNode
  | AudioDestinationNode
  | MediaStreamAudioSourceNode;

const connectablesBuilders: [any, (node: AudioNode) => Omit<AudioConnectables, 'vcId'>][] = [
  [
    // This must come before `GainNode` because it's also an instance of `GainNode`... >.>
    MicNode,
    (node: MicNode) => ({
      inputs: Map<string, { node: AudioParam | AudioNode; type: string }>(),
      outputs: Map<string, { node: AudioNode; type: string }>().set('output', {
        node,
        type: 'customAudio',
      }),
      node,
    }),
  ],
  [
    GainNode,
    (node: GainNode) => ({
      inputs: Map<string, { node: AudioParam | AudioNode; type: string }>(
        Object.entries({
          input: { node: node, type: 'customAudio' },
          gain: { node: node.gain, type: 'number' },
        })
      ),
      outputs: Map<string, { node: AudioNode; type: string }>().set('output', {
        node,
        type: 'customAudio',
      }),
      node,
    }),
  ],
  [
    ConstantSourceNode,
    (node: ConstantSourceNode) => ({
      inputs: Map<string, { node: AudioParam | AudioNode; type: string }>().set('offset', {
        node: node.offset,
        type: 'number',
      }),
      outputs: Map<string, { node: AudioNode; type: string }>().set('offset', {
        node,
        type: 'number',
      }),
      node,
    }),
  ],
  [
    BiquadFilterNode,
    (node: BiquadFilterNode) => ({
      inputs: Map<string, { node: AudioParam | AudioNode; type: string }>(
        Object.entries({
          frequency: { node: node.frequency, type: 'number' },
          Q: { node: node.Q, type: 'number' },
          detune: { node: node.detune, type: 'number' },
          gain: { node: node.gain, type: 'number' },
        })
      ),
      outputs: Map<string, { node: AudioNode; type: string }>().set('output', {
        node,
        type: 'customAudio',
      }),
      node,
    }),
  ],
  [
    AudioBufferSourceNode,
    (node: AudioBufferSourceNode) => ({
      inputs: Map<string, { node: AudioParam | AudioNode; type: string }>(),
      outputs: Map<string, { node: AudioNode; type: string }>().set('output', {
        node,
        type: 'customAudio',
      }),
      node,
    }),
  ],
  [
    AudioDestinationNode,
    (node: AudioDestinationNode) => ({
      inputs: Map<string, { node: AudioParam | AudioNode; type: string }>().set('input', {
        node,
        type: 'customAudio',
      }),
      outputs: Map<string, { node: AudioNode; type: string }>(),
      node,
    }),
  ],
];

export const buildConnectablesForNode = (node: ForeignNode, id: string): AudioConnectables => {
  const builder = connectablesBuilders.find(([NodeClass]) => node instanceof NodeClass);
  if (!builder) {
    throw new UnimplementedError(`Node not yet supported: ${node}`);
  }
  return { ...builder[1](node), vcId: id };
};

const ctx = new AudioContext();

export const audioNodeGetters: {
  [type: string]: {
    nodeGetter: () => ForeignNode;
    protoParams: { [key: string]: any };
  };
} = {
  'customAudio/gain': { nodeGetter: () => new GainNode(ctx), protoParams: {} },
  'customAudio/biquadFilter': { nodeGetter: () => new BiquadFilterNode(ctx), protoParams: {} },
  'customAudio/constantSource': {
    nodeGetter: () => {
      const csn = new ConstantSourceNode(ctx);
      csn.start();
      return csn;
    },
    protoParams: {
      onDrawForeground: function(this: any, ctx: CanvasRenderingContext2D) {
        ctx.strokeStyle = '#777';
        ctx.strokeText(this.properties.offset, 72, 14);
      },
    },
  },
  'customAudio/audioClip': {
    nodeGetter: () => new AudioBufferSourceNode(ctx),
    protoParams: {
      onDropFile: function(...args: unknown[]) {
        console.log('Dropped file: ', this, ...args);
      },
    },
  },
  'customAudio/destination': {
    nodeGetter: () => ctx.destination,
    protoParams: {},
  },
  'customAudio/microphone': {
    nodeGetter: () => micNode,
    protoParams: {},
  },
};

export const getDisplayNameByForeignNodeType = (foreignNodeType: string): string => {
  const displayNameByForeignNodeType: { [key: string]: string } = {
    'customAudio/gain': 'Gain',
    'customAudio/biquadFilter': 'Biquad Filter',
    'customAudio/constantSource': 'Constant Source',
    'customAudio/audioClip': 'Audio Clip',
    'customAudio/destination': 'Destination',
    'customAudio/microphone': 'Microphone',
  };

  const displayName = displayNameByForeignNodeType[foreignNodeType];
  if (!displayName) {
    console.error(`No display name for foreign node of type ${foreignNodeType}`);
    return 'Unknown';
  }
  return displayName;
};

export const getForeignNodeType = (foreignNode: ForeignNode) => {
  // This must come before `GainNode` because it's also an instance of `GainNode`... >.>
  if (foreignNode instanceof MicNode) {
    return 'customAudio/microphone';
  } else if (foreignNode instanceof GainNode) {
    return 'customAudio/gain';
  } else if (foreignNode instanceof BiquadFilterNode) {
    return 'customAudio/biquadFilter';
  } else if (foreignNode instanceof ConstantSourceNode) {
    return 'customAudio/constantSource';
  } else if (foreignNode instanceof AudioBufferSourceNode) {
    return 'customAudio/audioClip';
  } else if (foreignNode instanceof AudioDestinationNode) {
    return 'customAudio/destination';
  } else {
    throw new UnimplementedError(`Unable to get node type of unknown foreign node: ${foreignNode}`);
  }
};

const registerCustomAudioNode = (
  type: string,
  nodeGetter: () => ForeignNode,
  protoParams: { [key: string]: any }
) => {
  function CustomAudioNode(this: any) {
    // Default Properties
    this.properties = {};
    this.title = getDisplayNameByForeignNodeType(type);

    this.ctx = new AudioContext();
  }

  CustomAudioNode.prototype.onAdded = function(this: any) {
    if (this.connectables) {
      this.connectables.vcId = this.id.toString();
    } else {
      const connectables = buildConnectablesForNode(nodeGetter(), this.id);

      // Create empty placeholder connectables
      this.connectables = connectables;

      [...connectables.inputs.entries()].forEach(([name, input]) => {
        if (input instanceof AudioParam) {
          this.addProperty(name, input.node, input.type);
          this.addInput(name, input.type);
        } else {
          this.addInput(name, input.type);
        }
      });

      [...connectables.outputs.entries()].forEach(([name, output]) => {
        this.addOutput(name, output.type);
      });
    }

    addNode(this.id.toString(), this.connectables);
  };

  CustomAudioNode.prototype.onRemoved = function(this: any) {
    removeNode(this.id.toString());
  };

  CustomAudioNode.prototype.onPropertyChanged = LGAudioConnectables.prototype.onPropertyChanged;
  CustomAudioNode.prototype.onConnectionsChange = LGAudioConnectables.prototype.onConnectionsChange;
  CustomAudioNode.prototype.setConnectables = LGAudioConnectables.prototype.setConnectables;

  Object.entries(protoParams).forEach(([key, val]) => {
    CustomAudioNode.prototype[key] = val;
  });

  LiteGraph.registerNodeType(type, CustomAudioNode);
};

export const registerCustomAudioNodes = () =>
  Object.entries(audioNodeGetters).forEach(([type, { nodeGetter, protoParams }]) =>
    registerCustomAudioNode(type, nodeGetter, protoParams)
  );
