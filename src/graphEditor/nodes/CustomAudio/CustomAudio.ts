/**
 * Registers custom versions of the LiteGraph audio nodes.  These are special because their inner `AudioNode`s and `AudioParam`s
 * are managed outside of the mode - connecting them in LiteGraph is a no-op.  Connections between these nodes are managed
 * at the patch network level.
 */

import React from 'react';
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
import StatisticsNode from 'src/graphEditor/nodes/CustomAudio/StatisticsNode/StatisticsNode';
import { CSNSmallView } from 'src/graphEditor/nodes/CustomAudio/helpers';
import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import { getState } from 'src/redux';
import { ScaleAndShiftNode } from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift';
import WaveTable from 'src/graphEditor/nodes/CustomAudio/WaveTable/WaveTable';
import { EnvelopeGenerator } from 'src/graphEditor/nodes/CustomAudio/EnvelopeGenerator';
import { Equalizer } from 'src/graphEditor/nodes/CustomAudio/Equalizer';

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
  renderSmallView?: (domId: string) => void;
  cleanupSmallView?: (domId: string) => void;
}

interface EnhanceAudioNodeParams<T> {
  AudioNodeClass: new (ctx: AudioContext) => T;
  nodeType: string;
  name: string;
  buildConnectables: (
    foreignNode: ForeignNode<T> & {
      node: T;
    }
  ) => Omit<AudioConnectables, 'vcId'> & {
    node: ForeignNode<T>;
  };
  getOverridableParams: (
    node: T
  ) => {
    name: string;
    param: AudioParam;
  }[];
  paramKeys: string[];
  SmallViewRenderer?: React.FC<{ node: ForeignNode<T> }>;
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
const enhanceAudioNode = <T>({
  AudioNodeClass,
  nodeType,
  name,
  buildConnectables,
  getOverridableParams,
  paramKeys,
  SmallViewRenderer,
}: EnhanceAudioNodeParams<T>): new (
  ctx: AudioContext,
  vcId: string,
  params?: { [key: string]: any } | null,
  lgNode?: any
) => ForeignNode<T> =>
  class ForeignNodeClass implements ForeignNode<T> {
    private ctx: AudioContext;
    public vcId: string;
    public nodeType = nodeType;
    public name = name;
    public node: T;
    public lgNode?: any;

    public paramOverrides: {
      [name: string]: {
        param: OverridableAudioParam;
        override: ConstantSourceNode;
      };
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
      params?: {
        [key: string]: any;
      } | null,
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
          [name: string]: {
            param: OverridableAudioParam;
            override: ConstantSourceNode;
          };
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

      if (SmallViewRenderer) {
        this.renderSmallView = mkContainerRenderHelper({
          Comp: SmallViewRenderer,
          getProps: () => ({ node: this }),
        });
        this.cleanupSmallView = mkContainerCleanupHelper();
      }
    }

    public buildConnectables(): AudioConnectables & {
      node: ForeignNode<T>;
    } {
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

    public renderSmallView: ForeignNode['renderSmallView'] = undefined;
    public cleanupSmallView: ForeignNode['cleanupSmallView'] = undefined;
  };

const CustomGainNode = enhanceAudioNode({
  AudioNodeClass: GainNode,
  nodeType: 'customAudio/gain',
  name: 'Gain',
  buildConnectables: (
    node: ForeignNode<GainNode> & {
      node: GainNode;
    }
  ) => ({
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
  getOverridableParams: (node: GainNode) => [{ name: 'gain', param: node.gain }],
  paramKeys: ['gain'],
});

const CustomConstantSourceNode = enhanceAudioNode({
  AudioNodeClass: ConstantSourceNode,
  nodeType: 'customAudio/constantSource',
  name: 'Constant Source',
  buildConnectables: (
    foreignNode: ForeignNode<ConstantSourceNode> & {
      node: ConstantSourceNode;
    }
  ) => ({
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
  getOverridableParams: (node: ConstantSourceNode) => [{ name: 'offset', param: node.offset }],
  paramKeys: ['offset'],
  SmallViewRenderer: CSNSmallView,
});

const CustomBiquadFilterNode = enhanceAudioNode({
  AudioNodeClass: BiquadFilterNode,
  nodeType: 'customAudio/biquadFilter',
  name: 'Biquad Filter',
  buildConnectables: (
    foreignNode: ForeignNode<BiquadFilterNode> & {
      node: BiquadFilterNode;
    }
  ) => ({
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
  getOverridableParams: (node: BiquadFilterNode) => [
    { name: 'frequency', param: node.frequency },
    { name: 'Q', param: node.Q },
    { name: 'detune', param: node.detune },
    { name: 'gain', param: node.gain },
  ],
  paramKeys: ['frequency', 'Q', 'detune', 'gain'],
});

const CustomAudioBufferSourceNode = enhanceAudioNode({
  AudioNodeClass: AudioBufferSourceNode,
  nodeType: 'customAudio/audioClip',
  name: 'Audio Clip',
  buildConnectables: (
    foreignNode: ForeignNode<AudioBufferSourceNode> & {
      node: AudioBufferSourceNode;
    }
  ) => ({
    inputs: Map<string, ConnectableInput>(),
    outputs: Map<string, ConnectableOutput>().set('output', {
      node: foreignNode.node,
      type: 'customAudio',
    }),
    node: foreignNode,
  }),
  getOverridableParams: () => [],
  paramKeys: [],
});

const CustomDestinationNode = enhanceAudioNode({
  AudioNodeClass: class CustomAudioDestinationNode {
    constructor(ctx: AudioContext) {
      return (ctx as any).globalVolume as GainNode;
    }
  },
  nodeType: 'customAudio/destination',
  name: 'Destination',
  buildConnectables: (
    foreignNode: ForeignNode<GainNode> & {
      node: GainNode;
    }
  ) => ({
    inputs: Map<string, ConnectableInput>().set('input', {
      node: foreignNode.node,
      type: 'customAudio',
    }),
    outputs: Map<string, ConnectableOutput>(),
    node: foreignNode,
  }),
  getOverridableParams: () => [],
  paramKeys: [],
});

/**
 * A map of functions that can be used to build a new `ForeignNode`.  The getter provides the VC ID of the foreign node
 * that this will belong to as well as an optional `params` object of state to build it with.
 */
export const audioNodeGetters: {
  [type: string]: {
    nodeGetter: (vcId: string, params?: { [key: string]: any } | null) => ForeignNode;
    protoParams?: { [key: string]: any };
  };
} = {
  'customAudio/gain': {
    nodeGetter: (vcId: string, params) => new CustomGainNode(ctx, vcId, params),
  },
  'customAudio/biquadFilter': {
    nodeGetter: (vcId, params) => new CustomBiquadFilterNode(ctx, vcId, params),
  },
  'customAudio/constantSource': {
    nodeGetter: (vcId: string, params?: { [key: string]: any } | null) => {
      const csn = new CustomConstantSourceNode(ctx, vcId, params);
      csn.node!.start();
      return csn;
    },
  },
  'customAudio/audioClip': {
    nodeGetter: (vcId, params) => new CustomAudioBufferSourceNode(ctx, vcId, params),
    protoParams: {
      onDropFile: function (...args: unknown[]) {
        console.log('Dropped file: ', this, ...args);
      },
    },
  },
  'customAudio/destination': {
    nodeGetter: (vcId, params) => new CustomDestinationNode(ctx, vcId, params),
  },
  'customAudio/microphone': {
    nodeGetter: vcId => new MicNode(ctx, vcId),
  },
  'customAudio/mixer': {
    nodeGetter: (vcId: string, params) => new MixerNode(ctx, vcId, params),
    protoParams: {
      onDrawForeground: function (this: any, _ctx: CanvasRenderingContext2D) {
        // TODO
      },
    },
  },
  'customAudio/MIDIInput': {
    nodeGetter: (vcId: string, params) => new MIDIInputNode(ctx, vcId, params),
    protoParams: {
      onDrawForeground: function (this: MIDIInputNode, _ctx: CanvasRenderingContext2D) {
        // TODO: Render a button that, when clicked, updates the list of available MIDI editors
      },
      onAddedCustom: function (this: any) {
        this.connectables.node.updateInputs();
      },
      onPropertyChanged: function (
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
  },
  'customAudio/LFO': {
    nodeGetter: (vcId, params) => new LFONode(ctx, vcId, params),
  },
  'customAudio/statistics': {
    nodeGetter: (vcId, params) => new StatisticsNode(ctx, vcId, params),
  },
  'customAudio/scaleAndShift': {
    nodeGetter: (vcId, params) => new ScaleAndShiftNode(ctx, vcId, params),
  },
  'customAudio/wavetable': {
    nodeGetter: (vcId, params) => new WaveTable(ctx, vcId, params),
    protoParams: {
      onRemovedCustom: function (this: WaveTable) {
        this.shutdown();
      },
    },
  },
  'customAudio/envelopeGenerator': {
    nodeGetter: (vcId, params) => new EnvelopeGenerator(ctx, vcId, params),
  },
  'customAudio/Equalizer': {
    nodeGetter: (vcId, params) => new Equalizer(ctx, vcId, params),
    protoParams: {
      onRemovedCustom: function (this: any) {
        this.connectables.node.shutdown();
      },
    },
  },
};

const registerCustomAudioNode = (
  type: string,
  nodeGetter: (vcId: string) => ForeignNode,
  protoParams: { [key: string]: any }
) => {
  function CustomAudioNode(this: any) {
    if (R.isNil(this.id)) {
      this.id =
        [...getState().viewContextManager.patchNetwork.connectables.keys()]
          .filter((id: string) => !Number.isNaN(+id))
          .map(id => +id)
          .reduce((acc, id) => Math.max(acc, id), 0) + 1;
    }
  }

  CustomAudioNode.prototype.onAdded = function (this: any) {
    if (R.isNil(this.id)) {
      throw new Error('`id` was nil in `CustomAudioNode`');
    }

    const id: string = this.id.toString();
    if (Number.isNaN(+id)) {
      throw new Error(`\`CustomAudioNode\` was created with a non-numeric ID: "${id}"`);
    }

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
      if (connectables.vcId !== id) {
        console.error(
          `\`buildConnectables\` has a different vcId than the LG Node: ${connectables.vcId} vs ${id}`
        );
        connectables.vcId = id;
      }

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

  CustomAudioNode.prototype.onRemoved = function (this: any) {
    if (!this.ignoreRemove) {
      removeNode(this.id.toString());
      if (this.onRemovedCustom) {
        this.onRemovedCustom();
      }
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
    registerCustomAudioNode(type, nodeGetter, protoParams || {})
  );
