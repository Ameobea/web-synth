import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables } from 'src/patchNetwork';
import { Map as ImmMap } from 'immutable';
import { getState } from 'src/redux';
import { getEngine } from 'src/util';

interface SubgraphPortalNodeState {
  txSubgraphID: string;
  rxSubgraphID: string;
}

export class SubgraphPortalNode implements ForeignNode {
  private vcId: string | undefined;
  private txSubgraphID!: string;
  private rxSubgraphID!: string;

  static typeName = 'Subgraph Portal';
  static manuallyCreatable = false;
  public nodeType = 'customAudio/subgraphPortal';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: Record<string, any> | null) {
    this.vcId = vcId;
    this.deserialize(params);
  }

  public serialize(): SubgraphPortalNodeState {
    return { txSubgraphID: this.txSubgraphID, rxSubgraphID: this.rxSubgraphID };
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
  }

  buildConnectables(): AudioConnectables & { node: ForeignNode } {
    return {
      vcId: this.vcId!,
      inputs: ImmMap(),
      outputs: ImmMap(),
      node: this,
    };
  }

  public onNodeDblClicked() {
    getEngine()!.set_active_subgraph_id(this.rxSubgraphID);
  }
}
