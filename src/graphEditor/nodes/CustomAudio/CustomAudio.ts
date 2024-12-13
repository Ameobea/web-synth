/**
 * Registers custom versions of the LiteGraph audio nodes.  These are special because their inner `AudioNode`s and `AudioParam`s
 * are managed outside of the mode - connecting them in LiteGraph is a no-op.  Connections between these nodes are managed
 * at the patch network level.
 */
import { Option } from 'funfix-core';
import { Map } from 'immutable';
import { type LGraphNode, LiteGraph } from 'litegraph.js';
import * as R from 'ramda';
import type React from 'react';

import { AddNode } from 'src/graphEditor/nodes/CustomAudio/AddNode/AddNode';
import { MicNode } from 'src/graphEditor/nodes/CustomAudio/audioUtils';
import BandSplitterNode from 'src/graphEditor/nodes/CustomAudio/BandSplitter/BandSplitterNode';
import { CompressorNode } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';
import { CSNSmallView } from 'src/graphEditor/nodes/CustomAudio/CSNSmallView';
import CustomGainNodeSmallView from 'src/graphEditor/nodes/CustomAudio/CustomGainNodeSmallView';
import CustomDelayNode from 'src/graphEditor/nodes/CustomAudio/Delay/Delay';
import DistortionNode from 'src/graphEditor/nodes/CustomAudio/Distortion/Distortion';
import { EnvelopeGenerator } from 'src/graphEditor/nodes/CustomAudio/EnvelopeGenerator';
import FMSynth from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { LevelDetectorNode } from 'src/graphEditor/nodes/CustomAudio/LevelDetectorNode/LevelDetectorNode';
import { LFONode } from 'src/graphEditor/nodes/CustomAudio/LFONode';
import MIDIQuantizerNode from 'src/graphEditor/nodes/CustomAudio/MIDIQuantizer/MIDIQuantizerNode';
import { MIDIToFrequencyNode } from 'src/graphEditor/nodes/CustomAudio/MIDIToFrequency/MIDIToFrequency';
import { MixerNode } from 'src/graphEditor/nodes/CustomAudio/mixer/mixer';
import { MBDLDNode } from 'src/graphEditor/nodes/CustomAudio/MultibandDiodeLadderDistortion/MultibandDiodeLadderDistortionNode';
import { MultiplyNode } from 'src/graphEditor/nodes/CustomAudio/MultiplyNode/MultiplyNode';
import { NativeCompressorSmallViewShim } from 'src/graphEditor/nodes/CustomAudio/NativeCompressor/NativeCompressorSmallViewShim';
import { NoiseGenNode } from 'src/graphEditor/nodes/CustomAudio/NoiseGen';
import QuantizerNode from 'src/graphEditor/nodes/CustomAudio/Quantizer/QuantizerNode';
import SamplePlayerNode from 'src/graphEditor/nodes/CustomAudio/SamplePlayer/SamplePlayer';
import { ScaleAndShiftNode } from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift';
import { Sidechain } from 'src/graphEditor/nodes/CustomAudio/Sidechain';
import StatisticsNode from 'src/graphEditor/nodes/CustomAudio/StatisticsNode/StatisticsNode';
import { TypeConverterNode } from 'src/graphEditor/nodes/CustomAudio/TypeConverter/TypeConverterNode';
import { VocoderNode } from 'src/graphEditor/nodes/CustomAudio/Vocoder/VocoderNode';
import WaveTable from 'src/graphEditor/nodes/CustomAudio/WaveTable/WaveTable';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper, mkLazyComponent } from 'src/reactUtils';
import { getState } from 'src/redux';
import type { SampleDescriptor } from 'src/sampleLibrary';
import { LGAudioConnectables } from '../AudioConnectablesNode';
import { FMSynthFxNode } from './FMSynthFx/FMSynthFxNode';
import { SubgraphPortalNode } from 'src/graphEditor/nodes/CustomAudio/Subgraph/SubgraphPortalNode';
import { BPMNode } from 'src/graphEditor/nodes/CustomAudio/BPM/BPMNode';
import { CustomDestinationNode } from 'src/graphEditor/nodes/CustomAudio/Destination/CustomDestinationNode';

const ctx = new AudioContext();

export interface ForeignNode<T = any> {
  /**
   * A reference to the `LgNode` that is paired with this `ForeignNode`, if one exists.  This reference should only
   * be used for updating the LG node's presentational state; no state should ever be pulled out of the LG node.
   * The `ForeignNode` and its connectables by extension are the only things that are allowed to be stateful here.
   */
  lgNode?: any;
  /**
   * Callback invoked when a LG node is generated for this nodee
   */
  onAddedToLG?: (lgNode: LGraphNode) => void;
  /**
   * The underlying `AudioNode` that powers this custom node, if applicable.
   */
  node?: T;
  /**
   * Set to `false` if this node shouldn't be able to be created by the user via the graph editor's generic
   * "add node" menus.
   */
  manuallyCreatable?: boolean;
  serialize(): { [key: string]: any };
  buildConnectables(): AudioConnectables & { node: ForeignNode };
  nodeType: string;
  /**
   * See the docs for `enhanceAudioNode`.
   */
  paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  };
  renderSmallView?: (domId: string) => void;
  cleanupSmallView?: (domId: string) => void;
  /**
   * This method should be implemented by nodes that load samples.  It should return a list of all the samples that
   * are currently being used by this node.  This is used during composition sharing to make sure that any local
   * samples are converted into remote samples before saving so that they are available to other users loading
   * the composition.
   */
  listUsedSamples?: () => SampleDescriptor[];
  /**
   * This will be called when the node is double-clicked in the graph editor.
   */
  onNodeDblClicked?: () => void;
}

interface EnhanceAudioNodeParams<T> {
  AudioNodeClass: new (ctx: AudioContext) => T;
  nodeType: string;
  name: string;
  buildConnectables: (
    foreignNode: ForeignNode<T> & { node: T }
  ) => Omit<AudioConnectables, 'vcId'> & { node: ForeignNode<T> };
  getOverridableParams: (node: T) => {
    name: string;
    param: AudioParam;
    defaultValue?: number;
  }[];
  paramKeys: string[];
  SmallViewRenderer?: React.FC<{ node: ForeignNode<T> }>;
  listUsedSamples?: (node: T) => SampleDescriptor[];
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
  listUsedSamples,
}: EnhanceAudioNodeParams<T>): (new (
  ctx: AudioContext,
  vcId: string,
  params?: { [key: string]: any } | null,
  lgNode?: any
) => ForeignNode<T>) & { typeName: string } =>
  class ForeignNodeClass implements ForeignNode<T> {
    private ctx: AudioContext;
    public vcId: string;
    public nodeType = nodeType;
    static typeName = name;
    public node: T;
    public lgNode?: any;
    public listUsedSamples: () => SampleDescriptor[] = () => [];

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
      params?: { [key: string]: any } | null,
      lgNode?: any
    ) {
      this.node = new AudioNodeClass(ctx);
      this.vcId = vcId;
      this.lgNode = lgNode;
      this.ctx = ctx;

      if ((this.node as any).start) {
        (this.node as any).start();
      }

      if (SmallViewRenderer) {
        this.renderSmallView = mkContainerRenderHelper({
          Comp: SmallViewRenderer,
          getProps: () => ({ node: this }),
        });
        this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
      }
      this.listUsedSamples = listUsedSamples ? () => listUsedSamples(this.node) : () => [];

      this.paramOverrides = getOverridableParams(this.node).reduce(
        (acc, { name, param, defaultValue }) => {
          const override = new ConstantSourceNode(this.ctx);
          if (typeof defaultValue === 'number') {
            override.offset.value = defaultValue;
          }
          override.start();
          const overridableParam = new OverridableAudioParam(this.ctx, param, override);
          param.value = 0;

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
          (this.node as any)[key] = val;
          return;
        }

        valueContainer.value = val;
      });
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
          return { ...acc, [key]: valueContainer };
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
  buildConnectables: (node: ForeignNode<GainNode> & { node: GainNode }) => ({
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
  SmallViewRenderer: CustomGainNodeSmallView,
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
  getOverridableParams: (node: ConstantSourceNode) => [
    { name: 'offset', param: node.offset, defaultValue: 0 },
  ],
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
    { name: 'frequency', param: node.frequency, defaultValue: 1000 },
    { name: 'Q', param: node.Q, defaultValue: 0.001 },
    { name: 'detune', param: node.detune, defaultValue: 0 },
    { name: 'gain', param: node.gain, defaultValue: 0 },
  ],
  paramKeys: ['frequency', 'Q', 'detune', 'gain', 'type'],
  SmallViewRenderer: mkLazyComponent(
    () => import('src/graphEditor/nodes/CustomAudio/CustomBiquadFilterNodeSmallView')
  ),
});

const NativeCompressorNode = enhanceAudioNode({
  AudioNodeClass: DynamicsCompressorNode,
  nodeType: 'customAudio/nativeCompressor',
  name: 'Native Compressor',
  buildConnectables: (
    foreignNode: ForeignNode<DynamicsCompressorNode> & { node: DynamicsCompressorNode }
  ) => ({
    inputs: Map<string, ConnectableInput>(
      Object.entries({
        input: { node: foreignNode.node, type: 'customAudio' },
        threshold: { node: foreignNode.paramOverrides.threshold.param, type: 'number' },
        knee: { node: foreignNode.paramOverrides.knee.param, type: 'number' },
        ratio: { node: foreignNode.paramOverrides.ratio.param, type: 'number' },
        attack: { node: foreignNode.paramOverrides.attack.param, type: 'number' },
        release: { node: foreignNode.paramOverrides.release.param, type: 'number' },
      })
    ),
    outputs: Map<string, ConnectableOutput>().set('output', {
      node: foreignNode.node,
      type: 'customAudio',
    }),
    node: foreignNode,
  }),
  getOverridableParams: (node: DynamicsCompressorNode) => [
    { name: 'threshold', param: node.threshold, defaultValue: -24 },
    { name: 'knee', param: node.knee, defaultValue: 30 },
    { name: 'ratio', param: node.ratio, defaultValue: 12 },
    { name: 'attack', param: node.attack, defaultValue: 0.003 },
    { name: 'release', param: node.release, defaultValue: 0.25 },
  ],
  paramKeys: ['threshold', 'knee', 'ratio', 'attack', 'release'],
  SmallViewRenderer: NativeCompressorSmallViewShim,
});

/**
 * A map of functions that can be used to build a new `ForeignNode`.  The getter provides the VC ID of the foreign node
 * that this will belong to as well as an optional `params` object of state to build it with.
 */
export const audioNodeGetters: {
  [type: string]: {
    nodeGetter: (new (
      ctx: AudioContext,
      vcId: string,
      params?: { [key: string]: any } | null
    ) => ForeignNode) & { typeName: string };
    protoParams?: { [key: string]: any };
  };
} = {
  'customAudio/gain': {
    nodeGetter: CustomGainNode,
  },
  'customAudio/biquadFilter': {
    nodeGetter: CustomBiquadFilterNode,
  },
  'customAudio/constantSource': {
    nodeGetter: CustomConstantSourceNode,
  },
  'customAudio/destination': {
    nodeGetter: CustomDestinationNode,
  },
  'customAudio/microphone': {
    nodeGetter: MicNode,
  },
  'customAudio/mixer': {
    nodeGetter: MixerNode,
  },
  'customAudio/MIDIToFrequency': {
    nodeGetter: MIDIToFrequencyNode,
  },
  'customAudio/LFO': {
    nodeGetter: LFONode,
  },
  'customAudio/statistics': {
    nodeGetter: StatisticsNode,
  },
  'customAudio/scaleAndShift': {
    nodeGetter: ScaleAndShiftNode,
  },
  'customAudio/wavetable': {
    nodeGetter: WaveTable,
    protoParams: {
      onRemovedCustom: function () {
        this.connectables.node.shutdown();
      },
    },
  },
  'customAudio/envelopeGenerator': {
    nodeGetter: EnvelopeGenerator,
  },
  'customAudio/Sidechain': {
    nodeGetter: Sidechain,
  },
  'customAudio/NoiseGenerator': {
    nodeGetter: NoiseGenNode,
  },
  'customAudio/fmSynth': {
    nodeGetter: FMSynth,
  },
  'customAudio/distortion': {
    nodeGetter: DistortionNode,
  },
  'customAudio/delay': {
    nodeGetter: CustomDelayNode,
  },
  'customAudio/samplePlayer': {
    nodeGetter: SamplePlayerNode,
  },
  'customAudio/bandSplitter': {
    nodeGetter: BandSplitterNode,
  },
  'customAudio/midiQuantizer': {
    nodeGetter: MIDIQuantizerNode,
  },
  'customAudio/quantizer': {
    nodeGetter: QuantizerNode,
  },
  'customAudio/compressor': {
    nodeGetter: CompressorNode,
  },
  'customAudio/add': {
    nodeGetter: AddNode,
  },
  'customAudio/vocoder': {
    nodeGetter: VocoderNode,
  },
  'customAudio/typeConverter': {
    nodeGetter: TypeConverterNode,
  },
  'customAudio/fmSynthFx': {
    nodeGetter: FMSynthFxNode,
  },
  'customAudio/multiply': {
    nodeGetter: MultiplyNode,
  },
  'customAudio/levelDetector': {
    nodeGetter: LevelDetectorNode,
  },
  'customAudio/nativeCompressor': {
    nodeGetter: NativeCompressorNode,
  },
  'customAudio/multibandDiodeLadderDistortion': {
    nodeGetter: MBDLDNode,
  },
  'customAudio/subgraphPortal': {
    nodeGetter: SubgraphPortalNode,
  },
  'customAudio/bpm': {
    nodeGetter: BPMNode,
  },
};

/**
 * FCs are expected to always have numeric IDs, and we count up from 1
 */
export const buildNewForeignConnectableID = () =>
  [...getState().viewContextManager.patchNetwork.connectables.keys()]
    .filter((id: string) => !Number.isNaN(+id))
    .map(id => +id)
    .reduce((acc, id) => Math.max(acc, id), 0) + 1;

const registerCustomAudioNode = (
  type: string,
  nodeGetter: (new (
    ctx: AudioContext,
    vcId: string,
    params?: { [key: string]: any }
  ) => ForeignNode) & { typeName: string; manuallyCreatable?: boolean },
  protoParams: { [key: string]: any }
) => {
  function CustomAudioNode(this: any) {
    if (R.isNil(this.id)) {
      this.id = buildNewForeignConnectableID();
    }
  }

  CustomAudioNode.typeName = nodeGetter.typeName;
  CustomAudioNode.manuallyCreatable = nodeGetter.manuallyCreatable ?? true;

  CustomAudioNode.prototype.onAdded = function (this: any) {
    if (R.isNil(this.id)) {
      throw new Error('`id` was nil in `CustomAudioNode`');
    }

    const id: string = this.id.toString();
    if (Number.isNaN(+id)) {
      throw new Error(`\`CustomAudioNode\` was created with a non-numeric ID: "${id}"`);
    }

    if (this.connectables) {
      this.title = nodeGetter.typeName;
      if (!this.title) {
        console.error('Connectables had missing node `typeName`: ', this.connectables.node);
      }
      this.connectables.vcId = id;
      if (!this.connectables.node) {
        throw new Error('`CustomAudioNode` had connectables that have no `node` set');
      }

      // Add a reference to this LiteGraph node to the `ForeignNode`.  This facilitates getting serialized state from the
      // foreign node without holding a reference to this node, which is very helpful since we need to do that from the
      // patch network when changing state and we only have `AudioConnectables` there which only hold the foreign node.
      this.connectables.node.lgNode = this;
      (this as LGraphNode).shape = 1;
      this.connectables.node.onAddedToLG?.(this);
    } else {
      const foreignNode = new nodeGetter(ctx, id, this.foreignNodeParams);
      // Set the same reference as above
      foreignNode.lgNode = this;
      foreignNode.onAddedToLG?.(this);
      this.title = nodeGetter.typeName;
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
          (this as LGraphNode).addInput(name, input.type === 'any' ? (0 as any) : input.type);
        } else {
          (this as LGraphNode).addInput(name, input.type === 'any' ? (0 as any) : input.type);
        }
      });

      [...connectables.outputs.entries()].forEach(([name, output]) => {
        this.addOutput(name, output.type === 'any' ? (0 as any) : output.type);
      });
    }
  };

  CustomAudioNode.prototype.onRemoved = function (this: any) {
    this.onRemovedCustom?.();
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

  LiteGraph.registerNodeType(type, CustomAudioNode as any);
};

export const registerCustomAudioNodes = () =>
  Object.entries(audioNodeGetters).forEach(([type, { nodeGetter, protoParams }]) =>
    registerCustomAudioNode(type, nodeGetter, protoParams || {})
  );
