import { Map } from 'immutable';
import { UnimplementedError } from 'ameo-utils';
import { LiteGraph } from 'litegraph.js';

import { AudioConnectables, addNode, removeNode } from 'src/patchNetwork';
import { LGAudioConnectables } from '../AudioConnectablesNode';
import { micNode, MicNode } from 'src/graphEditor/nodes/CustomAudio/audioUtils';
import { MixerNode } from 'src/graphEditor/nodes/CustomAudio/mixer';
import { MIDIInputNode } from 'src/graphEditor/nodes/CustomAudio/midiInput';

/**
 * Registers custom versions of the LiteGraph audio nodes.  These are special because their inner `AudioNode`s and `AudioParam`s
 * are managed outside of the mode - connecting them in LiteGraph is a no-op.  Connections between these nodes are managed
 * at the patch network level.
 */

export type ForeignNode = {
  /**  A reference to the `LgNode` that is paired with this `ForeignNode`, if one exists.  This reference should only
   * be used for updating the LG node's presentational state; no state should ever be pulled out of the LG node.
   * The `ForeignNode` and its connectables by extension are the only things that are allowed to be stateful here.
   */
  lgNode?: any;
  /** A function that returns a piece of serialized state that can be used to re-construct the node when passed to its
   * `nodeGetter`.
   *
   * If no function is provided, this node is assumed to be stateless and will be re-initialized fresh when re-created.
   */
  serialize?: () => { [key: string]: any };
} & (
  | GainNode
  | ConstantSourceNode
  | BiquadFilterNode
  | AudioBufferSourceNode
  | AudioDestinationNode
  | MicNode
  | MixerNode
  | MIDIInputNode);

const connectablesBuilders: [
  any,
  (
    node: ForeignNode,
    vcId: string
  ) => Omit<AudioConnectables, 'vcId'> & {
    node: NonNullable<AudioConnectables['node']>;
  }
][] = [
  [
    // This must come before `GainNode` because it's also an instance of `GainNode`... >.>
    MicNode,
    (node: MicNode & { lgNode: any }) => ({
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
    (node: GainNode & { lgNode: any }) => ({
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
    (node: ConstantSourceNode & { lgNode: any }) => ({
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
    (node: BiquadFilterNode & { lgNode: any }) => ({
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
    (node: AudioBufferSourceNode & { lgNode: any }) => ({
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
    (node: AudioDestinationNode & { lgNode: any }) => ({
      inputs: Map<string, { node: AudioParam | AudioNode; type: string }>().set('input', {
        node,
        type: 'customAudio',
      }),
      outputs: Map<string, { node: AudioNode; type: string }>(),
      node,
    }),
  ],
  [MixerNode, (node: MixerNode) => node.buildConnectables()],
  [MIDIInputNode, (node: MIDIInputNode) => node.buildConnectables()],
];

export const buildConnectablesForNode = (node: ForeignNode, id: string): AudioConnectables => {
  const builder = connectablesBuilders.find(([NodeClass]) => node instanceof NodeClass);
  if (!builder) {
    throw new UnimplementedError(`Node not yet supported: ${node}`);
  }
  return { ...builder[1](node, id), vcId: id };
};

const ctx = new AudioContext();

/**
 * A map of functions that can be used to build a new `ForeignNode`.  The getter provides the VC ID of the foreign node
 * that this will belong to as well as an optional `params` object of state to build it with.
 */
export const audioNodeGetters: {
  [type: string]: {
    nodeGetter: (vcId: string, params?: { [key: string]: any } | null) => ForeignNode;
    protoParams: { [key: string]: any };
  };
} = {
  'customAudio/gain': { nodeGetter: () => new GainNode(ctx), protoParams: {} },
  'customAudio/biquadFilter': { nodeGetter: () => new BiquadFilterNode(ctx), protoParams: {} },
  'customAudio/constantSource': {
    nodeGetter: (_vcId: string, params?: { [key: string]: any } | null) => {
      const csn: ForeignNode = new ConstantSourceNode(ctx);
      if (params && typeof params.offset === 'number') {
        csn.offset.value = params.offset;
      }
      csn.start();
      csn.serialize = function(this: ConstantSourceNode) {
        return { offset: this.offset.value };
      };
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
  'customAudio/mixer': {
    nodeGetter: (vcId: string) => new MixerNode(vcId),
    protoParams: {
      onDrawForeground: function(this: any, _ctx: CanvasRenderingContext2D) {
        // TODO
      },
    },
  },
  'customAudio/MIDIInput': {
    nodeGetter: (vcId: string, params) => new MIDIInputNode(vcId, params),
    protoParams: {
      onDrawForeground: function(this: MIDIInputNode, _ctx: CanvasRenderingContext2D) {
        // TODO: Render a button that, when clicked, updates the list of available MIDI editors
      },
      onAddedCustom: function(this: any) {
        this.connectables.node.updateInputs();
      },
      onPropertyChanged: function(
        this: { connectables: AudioConnectables },
        name: string,
        value: any
      ) {
        if (name === 'inputName') {
          (this.connectables.node! as any).handleSelectedInputName(value);
        }
      },
    },
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
    'customAudio/mixer': 'Mixer',
    'customAudio/MIDIInput': 'MIDI Input',
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
  } else if (foreignNode instanceof MixerNode) {
    return 'customAudio/mixer';
  } else if (foreignNode instanceof MIDIInputNode) {
    return 'customAudio/MIDIInput';
  } else {
    throw new UnimplementedError(`Unable to get node type of unknown foreign node: ${foreignNode}`);
  }
};

const registerCustomAudioNode = (
  type: string,
  nodeGetter: (vcId: string) => ForeignNode,
  protoParams: { [key: string]: any }
) => {
  function CustomAudioNode(this: any) {
    // Default Properties
    this.properties = {};
    this.title = getDisplayNameByForeignNodeType(type);

    this.ctx = new AudioContext();
  }

  CustomAudioNode.prototype.onAdded = function(this: any) {
    const id = this.id.toString();
    if (this.connectables) {
      this.connectables.vcId = id;
      if (!this.connectables.node) {
        throw new Error('`CustomAudioNode` had connectables that have no `node` set');
      }

      // Add a reference to this LiteGraph node to the `ForeignNode`.  This facilitates getting serialized state from the
      // foreign node without holding a reference to this node, which is very helpful since we need to do that from the
      // patch network when changing state and we only have `AudioConnectables` there which only hold the foreign node.
      this.connectables.node.lgNode = this;
    } else {
      const foreignNode = nodeGetter(id);
      // Set the same reference as above
      foreignNode.lgNode = this;
      const connectables = buildConnectablesForNode(foreignNode, this.id);

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

    if (!this.ignoreAdd) {
      addNode(this.id.toString(), this.connectables);
    }

    if (this.onAddedCustom) {
      this.onAddedCustom();
    }
  };

  CustomAudioNode.prototype.onRemoved = function(this: any) {
    if (!this.ignoreRemove) {
      removeNode(this.id.toString());
    }
  };

  // Whenever any of the properties of the LG node are changed, they trigger the value of the underlying
  // `AudioNode`/`AudioParam` of the `ForeignNode`'s `AudioConnectables` to be set to the new value.
  //
  // This way, the state is persisted in the node and so we hold no source of truth in the LG node.
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
