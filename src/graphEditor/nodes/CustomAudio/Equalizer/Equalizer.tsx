import { Map } from 'immutable';

import EqualizerSmallView from './EqualizerUI';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { actionCreators, dispatch, getState } from 'src/redux';
import type { EqualizerPoint } from 'src/redux/modules/equalizer';
import { AsyncOnce } from 'src/util';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import DummyNode from 'src/graphEditor/nodes/DummyNode';

export const NEGATIVE_VALUE_DIVIDER_INTERVAL = 0.65;

const DEFAULT_POINTS: EqualizerPoint[] = [
  { x: 0, y: NEGATIVE_VALUE_DIVIDER_INTERVAL, index: 0 },
  { x: 1, y: NEGATIVE_VALUE_DIVIDER_INTERVAL, index: 1 },
];

const ctx = new AudioContext();
const EqualizerRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule(
    '/EqualizerWorkletProcessor.js?cacheBust=' + btoa(Math.random().toString())
  )
);

const EqualizerWasm = new AsyncOnce(() =>
  fetch(
    'https://storage.googleapis.com/web_synth-compiled_faust_modules_wasm/0f26ef8a4b554909c851c0e658674cbd439b023a_optimized.wasm'
  ).then(res => res.arrayBuffer())
);

export class Equalizer implements ForeignNode {
  private vcId: string;
  private workletHandle: FaustWorkletNode | null = null;
  public nodeType = 'customAudio/Equalizer';
  static typeName = 'Equalizer';

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
      dispatch(actionCreators.equalizer.ADD_EQUALIZER_INSTANCE(vcId, DEFAULT_POINTS));
    }

    this.renderSmallView = mkContainerRenderHelper({
      Comp: EqualizerSmallView,
      getProps: () => ({ vcId }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });

    EqualizerRegistered.get().then(async () => {
      this.workletHandle = new FaustWorkletNode(ctx, '', 'equalizer-audio-worklet-node-processor');
      updateConnectables(this.vcId, this.buildConnectables());
      const dspArrayBuffer = await EqualizerWasm.get();
      await this.workletHandle!.init(dspArrayBuffer, {
        customMessageHandler: (msg: MessageEvent) => {
          if (msg.data.levels) {
            dispatch(actionCreators.equalizer.SET_LEVELS(vcId, msg.data.levels));
          }
        },
      });

      dispatch(actionCreators.equalizer.REGISTER_NODE(vcId, this.workletHandle));
    });
  }

  public deserialize(params: { [key: string]: any }) {
    dispatch(actionCreators.equalizer.ADD_EQUALIZER_INSTANCE(this.vcId, params.points || []));
  }

  public serialize(): { [key: string]: any } {
    const instanceState = getState().equalizer[this.vcId];
    return {
      points: instanceState.points,
    };
  }

  public buildConnectables(): AudioConnectables & { node: ForeignNode } {
    const { points: knobs } = getState().equalizer[this.vcId];
    const inputs = knobs.reduce(
      (acc, knob) => {
        const withY = acc.set(`${knob.index + 1}_y`, { type: 'number', node: knob.yControl });
        if (knob.x === 0 || knob.x === 1 || !knob.xControl) {
          return withY;
        }
        return withY.set(`${knob.index + 1}_x`, { type: 'number', node: knob.xControl });
      },
      Map<string, ConnectableInput>().set('input', {
        type: 'customAudio',
        node: this.workletHandle || new DummyNode(),
      })
    );

    return {
      vcId: this.vcId,
      inputs,
      outputs: Map<string, ConnectableOutput>().set('output', {
        type: 'customAudio',
        node: this.workletHandle || new DummyNode(),
      }),
      node: this,
    };
  }

  public shutdown() {
    this.workletHandle?.port.postMessage({ type: 'shutdown' });
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
