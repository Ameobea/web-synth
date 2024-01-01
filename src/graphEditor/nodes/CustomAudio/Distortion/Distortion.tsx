import { Map as ImmMap } from 'immutable';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DistortionUI from 'src/graphEditor/nodes/CustomAudio/Distortion/DistortionUI';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { AsyncOnce } from 'src/util';

const DistortionWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'distortion.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);
const DistortionAWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH + 'DistortionAWP.js?cacheBust=' + genRandomStringID()
    ),
  true
);

export default class DistortionNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private awpHandle: AudioWorkletNode | null = null;
  private stretchFactorOAP: OverridableAudioParam | DummyNode = new DummyNode();

  static typeName = 'Distortion';
  public nodeType = 'customAudio/distortion';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    // TODO: Deserialize
    if (params) {
      this.deserialize(params);
    }

    this.init();

    this.renderSmallView = mkContainerRenderHelper({
      Comp: DistortionUI,
      getProps: () => ({
        onChange: newDistortionVal => {
          if (this.stretchFactorOAP instanceof DummyNode) {
            console.warn('Tried to set distortion before AWP initialized');
            return;
          }
          console.log({ newDistortionVal });
          this.stretchFactorOAP.manualControl.offset.value = newDistortionVal;
        },
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      DistortionWasmBytes.get(),
      DistortionAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'distortion-awp', {
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.stretchFactorOAP = new OverridableAudioParam(
      this.ctx,
      (this.awpHandle.parameters as Map<string, AudioParam>).get('stretch factor')!
    );

    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });

    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private deserialize(_params: { [key: string]: any }) {
    // TODO
  }

  public serialize() {
    return {}; // TODO
  }

  public buildConnectables() {
    return {
      // TODO: include all generated inputs
      inputs: ImmMap<string, ConnectableInput>()
        .set('input', {
          type: 'customAudio',
          node: this.awpHandle ? this.awpHandle : new DummyNode(),
        })
        .set('stretch factor', {
          type: 'number',
          node: this.awpHandle
            ? (this.awpHandle.parameters as Map<string, AudioParam>).get('stretch factor')!
            : new DummyNode(),
        }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'customAudio',
        node: this.awpHandle ? this.awpHandle : new DummyNode(),
      }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
