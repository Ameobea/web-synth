import { Map } from 'immutable';

import EqualizerSmallView from './EqualizerUI';
import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import {
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
  updateConnectables,
} from 'src/patchNetwork';
import { actionCreators, dispatch, getState } from 'src/redux';
import { EqualizerPoint } from 'src/redux/modules/equalizer';
import { AsyncOnce } from 'src/util';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import DummyNode from 'src/graphEditor/nodes/DummyNode';

const DEFAULT_POINTS: EqualizerPoint[] = [
  { x: 0, y: 0.65, index: 0 },
  { x: 1, y: 0.65, index: 1 },
];

const ctx = new AudioContext();
const EqualizerRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule('/EqualizerWorkletProcessor.js')
);

const EqualizerWasm = new AsyncOnce(() =>
  fetch('https://ameo.link/u/8k3.wasm').then(res => res.arrayBuffer())
);

export class Equalizer implements ForeignNode {
  private vcId: string;
  private workletHandle: FaustWorkletNode | null = null;
  public nodeType = 'customAudio/Equalizer';
  public name = 'Equalizer';

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
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

    EqualizerRegistered.get().then(async () => {
      this.workletHandle = new FaustWorkletNode(ctx, '', 'equalizer-audio-worklet-node-processor');
      const dspArrayBuffer = await EqualizerWasm.get();
      await this.workletHandle!.init(dspArrayBuffer);

      dispatch(actionCreators.equalizer.REGISTER_NODE(vcId, this.workletHandle));
      updateConnectables(this.vcId, dbg(this.buildConnectables()));
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
      inputs: Map<string, ConnectableInput>().set('input', {
        type: 'customAudio',
        node: this.workletHandle || new DummyNode(),
      }), // TODO
      outputs: Map<string, ConnectableOutput>().set('output', {
        type: 'customAudio',
        node: this.workletHandle || new DummyNode(),
      }), // TODO
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
