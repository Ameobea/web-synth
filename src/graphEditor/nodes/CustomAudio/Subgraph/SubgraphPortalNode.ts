import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type {
  AudioConnectables,
  ConnectableDescriptor,
  ConnectableInput,
  ConnectableOutput,
  ConnectableType,
} from 'src/patchNetwork';
import { Map as ImmMap } from 'immutable';
import { getEngine } from 'src/util';
import type { LGraphNode } from 'litegraph.js';
import { getState } from 'src/redux';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { PlaceholderOutput } from 'src/controlPanel/PlaceholderOutput';
import { get, writable, type Writable } from 'svelte/store';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import { PlaceholderInput } from 'src/controlPanel/PlaceholderInput';
import SubgraphPortalSmallView from 'src/graphEditor/nodes/CustomAudio/Subgraph/SubgraphPortalSmallView.svelte';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';

interface SubgraphPortalNodeState {
  txSubgraphID: string;
  rxSubgraphID: string;
  registeredInputs: { [name: string]: { type: ConnectableType } };
  registeredOutputs: { [name: string]: { type: ConnectableType } };
}

export type PortMap = {
  [name: string]: { type: ConnectableType; node: AudioNode | MIDINode };
};

export class SubgraphPortalNode implements ForeignNode {
  private vcId: string;
  private txSubgraphID!: string;
  private rxSubgraphID!: string;
  private registeredInputs: Writable<PortMap> = writable({});
  private registeredOutputs: Writable<PortMap> = writable({});
  private placeholderInput: PlaceholderInput;
  private placeholderOutput: PlaceholderOutput;

  static typeName = 'Subgraph Portal';
  static manuallyCreatable = false;
  public nodeType = 'customAudio/subgraphPortal';

  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: Record<string, any> | null) {
    if (!vcId) {
      throw new Error('`SubgraphPortalNode` must be created with a `vcId`');
    }
    this.vcId = vcId;
    this.deserialize(params);

    this.placeholderInput = new PlaceholderInput(
      ctx,
      this.vcId,
      () => this.buildConnectables(),
      this.addInput,
      'Add new input...'
    );
    this.placeholderOutput = new PlaceholderOutput(
      ctx,
      this.vcId,
      () => this.buildConnectables(),
      this.addOutput,
      'Add new output...'
    );

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: SubgraphPortalSmallView,
      getProps: () => ({
        inputs: this.registeredInputs,
        outputs: this.registeredOutputs,
        deletePort: (ports: Writable<PortMap>, name: string) => {
          ports.update(ports => {
            const newPorts = { ...ports };
            delete newPorts[name];
            return newPorts;
          });
          updateConnectables(this.vcId, this.buildConnectables());
        },
        renamePort: (ports: Writable<PortMap>, oldName: string, newName: string) => {
          ports.update(ports => {
            const newPorts = { ...ports };
            newPorts[newName] = newPorts[oldName];
            delete newPorts[oldName];
            return newPorts;
          });
          updateConnectables(this.vcId, this.buildConnectables());
        },
      }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  public onAddedToLG(lgNode: LGraphNode) {
    const subgraph = getState().viewContextManager.subgraphsByID[this.rxSubgraphID];
    lgNode.title = subgraph.name;
    lgNode.setSize([300, 100]);
    lgNode.color = '#382636';
    lgNode.shape = 1;
    lgNode.graph?.setDirtyCanvas(true, false);
  }

  public serialize(): SubgraphPortalNodeState {
    return {
      txSubgraphID: this.txSubgraphID,
      rxSubgraphID: this.rxSubgraphID,
      registeredInputs: Object.fromEntries(
        Object.entries(get(this.registeredInputs)).map(([k, v]) => [k, { type: v.type }])
      ),
      registeredOutputs: Object.fromEntries(
        Object.entries(get(this.registeredOutputs)).map(([k, v]) => [k, { type: v.type }])
      ),
    };
  }

  private deserialize(params: Record<string, any> | null | undefined) {
    if (!params) {
      throw new Error('`SubgraphPortalNode` must be created with params');
    }

    if (!params.txSubgraphID || typeof params.txSubgraphID !== 'string') {
      throw new Error('`SubgraphPortalNode` must be created with a `txSubgraphID` param');
    }
    this.txSubgraphID = params.txSubgraphID;

    if (!params.rxSubgraphID || typeof params.rxSubgraphID !== 'string') {
      throw new Error('`SubgraphPortalNode` must be created with a `rxSubgraphID` param');
    }
    this.rxSubgraphID = params.rxSubgraphID;

    if (params.registeredInputs) {
      this.registeredInputs.set(
        Object.fromEntries(
          Object.entries(
            params.registeredInputs as SubgraphPortalNodeState['registeredInputs']
          ).map(([k, v]) => [k, { type: v.type, node: new DummyNode(k) }])
        )
      );
    }
    if (params.registeredOutputs) {
      this.registeredOutputs.set(
        Object.fromEntries(
          Object.entries(
            params.registeredOutputs as SubgraphPortalNodeState['registeredOutputs']
          ).map(([k, v]) => [k, { type: v.type, node: new DummyNode(k) }])
        )
      );
    }
  }

  private addOutput = (
    outputName: string,
    type: ConnectableType,
    rxConnectableDescriptor: ConnectableDescriptor
  ) => {
    this.registeredOutputs.update(outputs => ({
      ...outputs,
      [outputName]: {
        type,
        node: new DummyNode(rxConnectableDescriptor.name),
      },
    }));
    updateConnectables(this.vcId, this.buildConnectables());

    // Find other subgraph portals that have our rx as their tx and add inputs to them to match this one
    for (const connectables of getState().viewContextManager.patchNetwork.connectables.values()) {
      if (connectables.node && connectables.node instanceof SubgraphPortalNode) {
        if (connectables.node.txSubgraphID === this.rxSubgraphID) {
          console.log(connectables.node, {
            thisVcId: this.vcId,
            otherVcId: connectables.node.vcId,
          });
          connectables.node.registeredInputs.update(inputs => ({
            ...inputs,
            [outputName]: { type, node: new DummyNode(rxConnectableDescriptor.name) },
          }));
          updateConnectables(connectables.node.vcId, connectables.node.buildConnectables());
        }
      }
    }
  };

  private addInput = (
    inputName: string,
    type: ConnectableType,
    txConnectableDescriptor: ConnectableDescriptor
  ) => {
    this.registeredInputs.update(inputs => ({
      ...inputs,
      [inputName]: {
        type,
        node: new DummyNode(txConnectableDescriptor.name),
      },
    }));
    updateConnectables(this.vcId, this.buildConnectables());

    // Find other subgraph portals that have our tx as their rx and add outputs to them to match this one
    for (const connectables of getState().viewContextManager.patchNetwork.connectables.values()) {
      if (connectables.node && connectables.node instanceof SubgraphPortalNode) {
        if (connectables.node.rxSubgraphID === this.txSubgraphID) {
          connectables.node.registeredOutputs.update(outputs => ({
            ...outputs,
            [inputName]: { type, node: new DummyNode(txConnectableDescriptor.name) },
          }));
          updateConnectables(connectables.node.vcId, connectables.node.buildConnectables());
        }
      }
    }
  };

  buildConnectables(): AudioConnectables & { node: ForeignNode } {
    let inputs = ImmMap<string, ConnectableInput>().set(this.placeholderInput.label, {
      type: 'any',
      node: this.placeholderInput,
    });
    for (const [name, descriptor] of Object.entries(get(this.registeredInputs))) {
      inputs = inputs.set(name, {
        type: 'any',
        node: descriptor.node,
      });
    }

    let outputs = ImmMap<string, ConnectableOutput>().set(this.placeholderOutput.label, {
      type: 'any',
      node: this.placeholderOutput,
    });
    for (const [name, descriptor] of Object.entries(get(this.registeredOutputs))) {
      outputs = outputs.set(name, {
        type: 'any',
        node: descriptor.node,
      });
    }

    return {
      vcId: this.vcId,
      inputs,
      outputs,
      node: this,
    };
  }

  public onNodeDblClicked() {
    getEngine()!.set_active_subgraph_id(this.rxSubgraphID);
  }
}
