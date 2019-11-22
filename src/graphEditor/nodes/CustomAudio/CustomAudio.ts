/**
 * Registers custom versions of the LiteGraph audio nodes.  These are special because their inner `AudioNode`s and `AudioParam`s
 * are managed outside of the mode - connecting them in LiteGraph is a no-op.  Connections between these nodes are managed
 * at the patch network level.
 */

import { Map } from 'immutable';
import { LiteGraph } from 'litegraph.js';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import {
  AudioConnectables,
  addNode,
  removeNode,
  ConnectableInput,
  ConnectableOutput,
} from 'src/patchNetwork';
import { LGAudioConnectables } from '../AudioConnectablesNode';
import { MicNode } from 'src/graphEditor/nodes/CustomAudio/audioUtils';
import { MixerNode } from 'src/graphEditor/nodes/CustomAudio/mixer';
import { MIDIInputNode } from 'src/graphEditor/nodes/CustomAudio/midiInput';
import { MIDIToFrequencyNode } from 'src/graphEditor/nodes/CustomAudio/midiToFrequency';
import { LFONode } from 'src/graphEditor/nodes/CustomAudio/LFONode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import {
  LiteGraphLink,
  LiteGraphNodeInput,
  LiteGraph as LiteGraphType,
} from 'src/graphEditor/LiteGraphTypes';

const ctx = new AudioContext();

export interface ForeignNode<T = any> {
  /**
   * A reference to the `LgNode` that is paired with this `ForeignNode`, if one exists.  This reference should only
   * be used for updating the LG node's presentational state; no state should ever be pulled out of the LG node.
   * The `ForeignNode` and its connectables by extension are the only things that are allowed to be stateful here.
   */
  lgNode?: any;
  /**
   * The underlying `AudioNode` that powers this custom node, if applicable.
   */
  node?: T;
  serialize(): { [key: string]: any };
  buildConnectables(): AudioConnectables & { node: ForeignNode };
  nodeType: string;
  name: string;
  /**
   * See the docs for `enhanceAudioNode`.
   */
  paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  };
}

/**
 * Wraps an `AudioNode`, creating a new class that can be used as a custom audio node in the patch network.  It generates
 * a constructor that takes the provided `params` argument and attempts to set the value of all `AudioNode`s / `AudioParam`s
 * within `T` that have keys matching those of the params and setting their values accordingly.
 *
 * It also generates a corresponding `serialize()` method that creates a matching `params` object accordingly.
 *
 * @param getOverridableParams Given the inner node being enhanced, returns a list of param descriptors that should be
 * made overridable via `OverridableAudioParam` and register a listener for connection events that target them.  If
 * anything is connected to one of these param in the patch network, the value of that connected node will be passed
 * through.  Otherwise, the value of the node will be set internally from a `ConstantSourceNode`.  That
 * `ConstantSourceNode` will have its value de/serialized + persisted in between refreshes and can be used to implement
 * built-in UIs.
 */
const enhanceAudioNode = <T>(
  AudioNodeClass: new (ctx: AudioContext) => T,
  nodeType: string,
  name: string,
  buildConnectables: (
    foreignNode: ForeignNode<T> & { node: T }
  ) => Omit<AudioConnectables, 'vcId'> & { node: ForeignNode<T> },
  getOverridableParams: (node: T) => { name: string; param: AudioParam }[],
  paramKeys: string[]
): new (
  ctx: AudioContext,
  vcId: string,
  params?: { [key: string]: any } | null,
  lgNode?: any
) => ForeignNode<T> => {
  return class ForeignNodeClass implements ForeignNode<T> {
    private ctx: AudioContext;

    public vcId: string;
    public nodeType = nodeType;
    public name = name;
    public node: T;
    public lgNode?: any;

    public paramOverrides: {
      [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
    };

    private getValueContainer(key: string): AudioParam | null {
      return Option.of(this.paramOverrides[key])
        .map(R.prop('override'))
        .map(R.prop('offset'))
        .orElse(Option.of((this.node as any)[key]))
        .orNull();
    }

    constructor(
      ctx: AudioContext,
      vcId: string,
      params?: { [key: string]: any } | null,
      lgNode?: any
    ) {
      this.node = new AudioNodeClass(ctx);
      this.vcId = vcId;
      this.lgNode = lgNode;
      this.ctx = ctx;

      this.paramOverrides = getOverridableParams(this.node).reduce(
        (acc, { name, param }) => {
          const override = new ConstantSourceNode(this.ctx);
          override.start();
          const overridableParam = new OverridableAudioParam(this.ctx, param, override);

          return { ...acc, [name]: { param: overridableParam, override } };
        },
        {} as {
          [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
        }
      );

      if (!params) {
        return;
      }

      Object.entries(params).forEach(([key, val]) => {
        // Either use the overrideable param if it's available or try to find it directly on the wrapped node
        const valueContainer = this.getValueContainer(key);

        if (!valueContainer) {
          console.error(`No property "${key}" of node named ${name}; not setting value.`);
          return;
        } else if (!(valueContainer instanceof AudioParam)) {
          console.error(
            `Property "${key}" of node named ${name} isn't an \`AudioParam\`; not setting value.`
          );
          return;
        }

        valueContainer.value = val;
      });
    }

    public buildConnectables(): AudioConnectables & { node: ForeignNode<T> } {
      return { ...buildConnectables(this), vcId: this.vcId };
    }

    public serialize() {
      return paramKeys.reduce((acc, key) => {
        const valueContainer = this.getValueContainer(key);

        if (!valueContainer) {
          console.error(`No property "${key}" of node named ${name}; not setting value.`);
          return acc;
        } else if (!(valueContainer instanceof AudioParam)) {
          console.error(
            `Property "${key}" of node named ${name} isn't an \`AudioParam\`; not setting value.`
          );
          return acc;
        }

        return { ...acc, [key]: valueContainer.value };
      }, {});
    }
  };
};

const CustomGainNode = enhanceAudioNode(
  GainNode,
  'customAudio/gain',
  'Gain',
  (node: ForeignNode<GainNode> & { node: GainNode }) => ({
    inputs: Map<string, ConnectableInput>(
      Object.entries({
        input: { node: node.node, type: 'customAudio' },
        gain: { node: node.paramOverrides.gain.param, type: 'number' },
      })
    ),
    outputs: Map<string, ConnectableOutput>().set('output', {
      node: node.node,
      type: 'customAudio',
    }),
    node,
  }),
  (node: GainNode) => [{ name: 'gain', param: node.gain }],
  ['gain']
);

const CustomConstantSourceNode = enhanceAudioNode(
  ConstantSourceNode,
  'customAudio/constantSource',
  'Constant Source',
  (foreignNode: ForeignNode<ConstantSourceNode> & { node: ConstantSourceNode }) => ({
    inputs: Map<string, ConnectableInput>().set('offset', {
      node: foreignNode.paramOverrides.offset.param,
      type: 'number',
    }),
    outputs: Map<string, ConnectableOutput>().set('offset', {
      node: foreignNode.node,
      type: 'number',
    }),
    node: foreignNode,
  }),
  (node: ConstantSourceNode) => [{ name: 'offset', param: node.offset }],
  ['offset']
);

const CustomBiquadFilterNode = enhanceAudioNode(
  BiquadFilterNode,
  'customAudio/biquadFilter',
  'Biquad Filter',
  (foreignNode: ForeignNode<BiquadFilterNode> & { node: BiquadFilterNode }) => ({
    inputs: Map<string, ConnectableInput>(
      Object.entries({
        input: { node: foreignNode.node, type: 'customAudio' },
        frequency: { node: foreignNode.paramOverrides.frequency.param, type: 'number' },
        Q: { node: foreignNode.paramOverrides.Q.param, type: 'number' },
        detune: { node: foreignNode.paramOverrides.detune.param, type: 'number' },
        gain: { node: foreignNode.paramOverrides.gain.param, type: 'number' },
      })
    ),
    outputs: Map<string, ConnectableOutput>().set('output', {
      node: foreignNode.node,
      type: 'customAudio',
    }),
    node: foreignNode,
  }),
  (node: BiquadFilterNode) => [
    { name: 'frequency', param: node.frequency },
    { name: 'Q', param: node.Q },
    { name: 'detune', param: node.detune },
    { name: 'gain', param: node.gain },
  ],
  ['frequency', 'Q', 'detune', 'gain']
);

const CustomAudioBufferSourceNode = enhanceAudioNode(
  AudioBufferSourceNode,
  'customAudio/audioClip',
  'Audio Clip',
  (foreignNode: ForeignNode<AudioBufferSourceNode> & { node: AudioBufferSourceNode }) => ({
    inputs: Map<string, ConnectableInput>(),
    outputs: Map<string, ConnectableOutput>().set('output', {
      node: foreignNode.node,
      type: 'customAudio',
    }),
    node: foreignNode,
  }),
  () => [],
  []
);

const CustomDestinationNode = enhanceAudioNode(
  class CustomAudioDestinationNode {
    constructor(ctx: AudioContext) {
      return ctx.destination;
    }
  },
  'customAudio/destination',
  'Destination',
  (foreignNode: ForeignNode<AudioDestinationNode> & { node: AudioDestinationNode }) => ({
    inputs: Map<string, ConnectableInput>().set('input', {
      node: foreignNode.node,
      type: 'customAudio',
    }),
    outputs: Map<string, ConnectableOutput>(),
    node: foreignNode,
  }),
  () => [],
  []
);

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
  'customAudio/gain': {
    nodeGetter: (vcId: string, params) => new CustomGainNode(ctx, vcId, params),
    protoParams: {},
  },
  'customAudio/biquadFilter': {
    nodeGetter: (vcId, params) => new CustomBiquadFilterNode(ctx, vcId, params),
    protoParams: {},
  },
  'customAudio/constantSource': {
    nodeGetter: (vcId: string, params?: { [key: string]: any } | null) => {
      const csn = new CustomConstantSourceNode(ctx, vcId, params);
      csn.node!.start();
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
    nodeGetter: (vcId, params) => new CustomAudioBufferSourceNode(ctx, vcId, params),
    protoParams: {
      onDropFile: function(...args: unknown[]) {
        console.log('Dropped file: ', this, ...args);
      },
    },
  },
  'customAudio/destination': {
    nodeGetter: (vcId, params) => new CustomDestinationNode(ctx, vcId, params),
    protoParams: {},
  },
  'customAudio/microphone': {
    nodeGetter: vcId => new MicNode(ctx, vcId),
    protoParams: {},
  },
  'customAudio/mixer': {
    nodeGetter: (vcId: string, params) => new MixerNode(ctx, vcId, params),
    protoParams: {
      onDrawForeground: function(this: any, _ctx: CanvasRenderingContext2D) {
        // TODO
      },
    },
  },
  'customAudio/MIDIInput': {
    nodeGetter: (vcId: string, params) => new MIDIInputNode(ctx, vcId, params),
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
  'customAudio/MIDIToFrequency': {
    nodeGetter: (vcId, params) => new MIDIToFrequencyNode(vcId, params),
    protoParams: {},
  },
  'customAudio/LFO': {
    nodeGetter: (vcId, params) => new LFONode(ctx, vcId, params),
    protoParams: {},
  },
};

const registerCustomAudioNode = (
  type: string,
  nodeGetter: (vcId: string) => ForeignNode,
  protoParams: { [key: string]: any }
) => {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  function CustomAudioNode(this: any) {}

  CustomAudioNode.prototype.onAdded = function(this: any) {
    if (R.isNil(this.id)) {
      throw new Error('`id` was nil in `CustomAudioNode`');
    }
    const id: string = this.id.toString();

    if (this.connectables) {
      this.title = this.connectables.node.name;
      if (!this.connectables.node.name) {
        console.error('Connectables had missing node name: ', this.connectables.node);
      }
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
      this.title = foreignNode.name;
      const connectables = foreignNode.buildConnectables();

      // Create empty placeholder connectables
      this.connectables = connectables;

      [...connectables.inputs.entries()].forEach(([name, input]) => {
        if (input instanceof AudioParam) {
          this.addProperty(name, input.node, input.type);
          const value = (connectables.node as any).node?.[name]?.value;
          if (!R.isNil(value)) {
            this.setProperty(name, value);
          }
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
  CustomAudioNode.prototype.onConnectionsChange = function(
    this: { graph: LiteGraphType; connectables: AudioConnectables & { node: ForeignNode } },
    connection: 1 | 2,
    slot: number,
    isNowConnected: boolean,
    linkInfo: LiteGraphLink,
    inputInfo: LiteGraphNodeInput
  ) {
    const thisNodeIsDestination = connection === 1;
    if (thisNodeIsDestination) {
      (() => {
        const dstNode = this.graph._nodes_by_id[linkInfo.target_id];
        if (!dstNode) {
          return;
        }
        const dstInput = dstNode.inputs[linkInfo.target_slot];
        if (!dstInput) {
          return;
        }

        // Check to see if we dis/connected to/from an overridable param
        const overrideDescriptor = this.connectables.node.paramOverrides[dstInput.name];
        if (overrideDescriptor) {
          console.log(
            `Setting overridable param named ${dstInput.name} as ${
              isNowConnected ? 'NOT ' : ''
            }overridden.`
          );
          overrideDescriptor.param.setIsOverridden(!isNowConnected);
        }
      })();
    }

    LGAudioConnectables.prototype.onConnectionsChange.call(
      this,
      connection,
      slot,
      isNowConnected,
      linkInfo,
      inputInfo
    );
  };
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
