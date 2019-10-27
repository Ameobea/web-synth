import { Map } from 'immutable';
import { UnimplementedError } from 'ameo-utils';
import { LiteGraph } from 'litegraph.js';

import { AudioConnectables, addNode, removeNode } from 'src/patchNetwork';
import { LGAudioConnectables } from '../AudioConnectablesNode';
import { micNode } from 'src/graphEditor/nodes/CustomAudio/audioUtils';

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

const connectablesBuilders: [
  any,
  (
    node: AudioNode
  ) => {
    inputs: Map<string, AudioParam | AudioNode>;
    outputs: Map<string, AudioNode>;
    node: AudioNode;
  }
][] = [
  [
    GainNode,
    (node: GainNode) => ({
      inputs: Map<string, AudioParam | AudioNode>(
        Object.entries({
          input: node,
          gain: node.gain,
        })
      ),
      outputs: Map<string, AudioNode>().set('output', node),
      node,
    }),
  ],
  [
    ConstantSourceNode,
    (node: ConstantSourceNode) => ({
      inputs: Map<string, AudioParam | AudioNode>().set('offset', node.offset),
      outputs: Map<string, AudioNode>().set('offset', node),
      node,
    }),
  ],
  [
    BiquadFilterNode,
    (node: BiquadFilterNode) => ({
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
    }),
  ],
  [
    AudioBufferSourceNode,
    (node: AudioBufferSourceNode) => ({
      inputs: Map<string, AudioParam | AudioNode>(),
      outputs: Map<string, AudioNode>().set('output', node),
      node,
    }),
  ],
  [
    AudioDestinationNode,
    (node: AudioDestinationNode) => ({
      inputs: Map<string, AudioParam | AudioNode>().set('input', node),
      outputs: Map<string, AudioNode>(),
      node,
    }),
  ],
  [
    MediaStreamAudioSourceNode,
    (node: MediaStreamAudioSourceNode) => ({
      inputs: Map<string, AudioParam | AudioNode>(),
      outputs: Map<string, AudioNode>().set('output', node),
      node,
    }),
  ],
];

export const buildConnectablesForNode = (node: ForeignNode, id: string): AudioConnectables => {
  const builder = connectablesBuilders.find(([NodeClass]) => node instanceof NodeClass);
  if (!builder) {
    throw new UnimplementedError(`Node not yet supported: ${node}`);
  }
  return { ...(builder[1] as any)(node), vcId: id };
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
  if (foreignNode instanceof GainNode) {
    return 'customAudio/gain';
  } else if (foreignNode instanceof BiquadFilterNode) {
    return 'customAudio/biquadFilter';
  } else if (foreignNode instanceof ConstantSourceNode) {
    return 'customAudio/constantSource';
  } else if (foreignNode instanceof AudioBufferSourceNode) {
    return 'customAudio/audioClip';
  } else if (foreignNode instanceof AudioDestinationNode) {
    return 'customAudio/destination';
  } else if (foreignNode instanceof MediaStreamAudioSourceNode) {
    return 'customAudio/microphone';
  } else {
    throw new UnimplementedError(`Unable to get node type of unknown foreign node: ${foreignNode}`);
  }
};

const registerCustomAudioNode = (
  type: string,
  nodeGetter: () => ForeignNode,
  protoParams: { [key: string]: any }
) => {
  function CustomAudioNode(this: any, title: string) {
    // Default Properties
    this.properties = {};
    this.title = title || type;

    this.ctx = new AudioContext();

    // Avoid setting connectables if we already have some
    if (this.connectables) {
      return;
    }

    const connectables = buildConnectablesForNode(nodeGetter(), this.id);

    // Create empty placeholder connectables
    this.connectables = connectables;

    [...connectables.inputs.entries()].forEach(([name, input]) => {
      if (input instanceof AudioParam) {
        this.addProperty(name, input.value, 'number');
        this.addInput(name, 'audio');
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
