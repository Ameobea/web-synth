import { Map } from 'immutable';

import EqualizerSmallView from './EqualizerUI';
import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { actionCreators, dispatch, getState } from 'src/redux';
import { EqualizerPoint } from 'src/redux/modules/equalizer';

const DEFAULT_POINTS: EqualizerPoint[] = [
  { x: 0, y: 0.6, index: 0 },
  { x: 1, y: 0.6, index: 1 },
];

let equalizerIsRegistered: boolean | Promise<void> = false;
const registerEqualizer = async (ctx: AudioContext) => {
  if (equalizerIsRegistered === true) {
    return;
  } else if (equalizerIsRegistered !== false) {
    await equalizerIsRegistered;
    return;
  }

  const prom = ctx.audioWorklet.addModule('/EqualizerWorkletProcessor.js');
  equalizerIsRegistered = prom;
  await prom;
  equalizerIsRegistered = true;
};

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
      dispatch(actionCreators.equalizer.ADD_INSTANCE(vcId, DEFAULT_POINTS));
    }

    this.renderSmallView = mkContainerRenderHelper({
      Comp: EqualizerSmallView,
      getProps: () => ({ vcId }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper();

    registerEqualizer(ctx).then(() => {
      const workletHandle = new AudioWorkletNode(ctx, 'equalizer-audio-worklet-node-processor');
      dispatch(actionCreators.equalizer.REGISTER_NODE(vcId, workletHandle));
    });
  }

  public deserialize(params: { [key: string]: any }) {
    dispatch(actionCreators.equalizer.ADD_INSTANCE(this.vcId, params.points || []));
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
