import { Map } from 'immutable';

import EqualizerSmallView from './EqualizerUI';
import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { actionCreators, dispatch, getState } from 'src/redux';
import { EqualizerPoint } from 'src/redux/modules/equalizer';

const DEFAULT_POINTS: EqualizerPoint[] = [
  { x: 0, y: 0.6 },
  { x: 1, y: 0.6 },
];

export class Equalizer implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string;
  public nodeType = 'customAudio/Equalizer';
  public name = 'Equalizer';

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params) {
      this.deserialize(params);
    } else {
      dispatch(actionCreators.equalizer.ADD_INSTANCE(vcId, { points: DEFAULT_POINTS }));
    }

    this.renderSmallView = mkContainerRenderHelper({
      Comp: EqualizerSmallView,
      getProps: () => ({ vcId }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper();
  }

  public deserialize(params: { [key: string]: any }) {
    dispatch(actionCreators.equalizer.ADD_INSTANCE(this.vcId, { points: params.points || [] }));
  }

  public serialize(): { [key: string]: any } {
    const instanceState = getState().equalizer[this.vcId];
    return {
      points: instanceState.points,
    };
  }

  public buildConnectables(): AudioConnectables & { node: ForeignNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>(), // TODO
      outputs: Map<string, ConnectableOutput>(), // TODO
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
