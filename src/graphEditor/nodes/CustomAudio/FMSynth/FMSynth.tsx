import { Map as ImmMap } from 'immutable';
import FMSynthUI from 'src/fmSynth/FMSynthUI';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { WavetableWasmBytes } from 'src/graphEditor/nodes/CustomAudio/WaveTable';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { ConnectableInput, ConnectableOutput, updateConnectables } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';

type FMSynthInputDescriptor =
  | { type: 'modulationValue'; srcOperatorIx: number; dstOperatorIx: number }
  | { type: 'outputWeight'; operatorIx: number };

export default class WaveTable implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string;
  private generatedInputs: FMSynthInputDescriptor[] = [];
  private awpHandle: AudioWorkletNode | null = null;

  static typeName = 'FM Synthesizer';
  public nodeType = 'customAudio/fmSynth';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    // TODO: Deserialize

    this.init();

    this.renderSmallView = mkContainerRenderHelper({
      Comp: FMSynthUI,
      getProps: () => ({
        updateBackend: (operatorIx: number, modulationIx: number, val: number) => {
          // TODO
        },
      }),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      WavetableWasmBytes.get(),
      this.ctx.audioWorklet.addModule('/FMSynthAWP.js'),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'fm-synth-audio-worklet-processor');

    // TODO: Initialize with serialized values
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
    setTimeout(() => {
      this.awpHandle!.port.postMessage({
        type: 'setOutputWeightValue',
        operatorIx: 0,
        valueType: 1,
        valParamInt: 0,
        valParamFloat: 0.5,
      });
      this.awpHandle!.port.postMessage({
        type: 'setModulationValue',
        srcOperatorIx: 2,
        dstOperatorIx: 0,
        valueType: 1,
        valParamInt: 0,
        valParamFloat: 380,
      });
      this.awpHandle!.port.postMessage({
        type: 'setModulationValue',
        srcOperatorIx: 1,
        dstOperatorIx: 0,
        valueType: 1,
        valParamInt: 0,
        valParamFloat: 400,
      });
      this.awpHandle!.port.postMessage({
        type: 'setModulationValue',
        srcOperatorIx: 1,
        dstOperatorIx: 1,
        valueType: 1,
        valParamInt: 0,
        valParamFloat: 180,
      });
    }, 800);

    updateConnectables(this.vcId, this.buildConnectables());
  }

  private buildParamOverrides(workletHandle: AudioWorkletNode): ForeignNode['paramOverrides'] {
    return {}; // TODO
  }

  private deserialize(params: { [key: string]: any }) {
    // TODO
  }

  public serialize() {
    return {}; // TODO
  }

  public buildConnectables() {
    return {
      // TODO: include all generated inputs
      inputs: ImmMap<string, ConnectableInput>(),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'customAudio',
        node: this.awpHandle ? this.awpHandle : new DummyNode(),
      }),
      vcId: this.vcId,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
