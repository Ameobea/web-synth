import { type LGraphNode, LiteGraph } from 'litegraph.js';
import * as R from 'ramda';

import { LGAudioConnectables } from 'src/graphEditor/nodes/AudioConnectablesNode';
import {
  audioNodeGetters,
  buildNewForeignConnectableID,
  type ForeignNode,
} from 'src/graphEditor/nodes/CustomAudio/CustomAudio';

const ctx = new AudioContext();

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
