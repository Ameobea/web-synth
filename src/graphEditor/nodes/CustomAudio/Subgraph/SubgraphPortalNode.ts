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

interface SubgraphPortalNodeState {
  txSubgraphID: string;
  rxSubgraphID: string;
  registeredInputs: { [name: string]: { type: ConnectableType } };
  registeredOutputs: { [name: string]: { type: ConnectableType } };
}

export class SubgraphPortalNode implements ForeignNode {
  private vcId: string;
  private txSubgraphID!: string;
  private rxSubgraphID!: string;
  private registeredInputs: Writable<{
    [name: string]: { type: ConnectableType; dummyNode: DummyNode };
  }> = writable({});
  private registeredOutputs: Writable<{
    [name: string]: { type: ConnectableType; dummyNode: DummyNode };
  }> = writable({});
  private dummyInput: DummyNode;
  private dummyOutput: PlaceholderOutput;

  static typeName = 'Subgraph Portal';
  static manuallyCreatable = false;
  public nodeType = 'customAudio/subgraphPortal';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: Record<string, any> | null) {
    if (!vcId) {
      throw new Error('`SubgraphPortalNode` must be created with a `vcId`');
    }
    this.vcId = vcId;
    this.deserialize(params);

    this.dummyOutput = new PlaceholderOutput(
      ctx,
      this.vcId,
      () => this.buildConnectables(),
      this.addOutput,
      'Add new output...'
    );
    this.dummyInput = new DummyNode('Add new input...');
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
      this.registeredInputs.set(params.registeredInputs);
    }
    if (params.registeredOutputs) {
      this.registeredOutputs.set(
        Object.fromEntries(
          Object.entries(
            params.registeredOutputs as SubgraphPortalNodeState['registeredOutputs']
          ).map(([k, v]) => [k, { type: v.type, dummyNode: new DummyNode(k) }])
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
        dummyNode: new DummyNode(rxConnectableDescriptor.name),
      },
    }));
  };

  buildConnectables(): AudioConnectables & { node: ForeignNode } {
    let outputs = ImmMap<string, ConnectableOutput>().set(this.dummyOutput.label, {
      type: 'any',
      node: this.dummyOutput,
    });
    for (const [name, descriptor] of Object.entries(get(this.registeredOutputs))) {
      outputs = outputs.set(name, {
        type: 'any',
        node: descriptor.dummyNode,
      });
    }

    return {
      vcId: this.vcId,
      inputs: ImmMap<string, ConnectableInput>().set(this.dummyInput.name, {
        type: 'any',
        node: this.dummyOutput,
      }),
      outputs,
      node: this,
    };
  }

  public onNodeDblClicked() {
    console.log(this);
    getEngine()!.set_active_subgraph_id(this.rxSubgraphID);
  }
}
