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
        updateBackendModulation: (srcOperatorIx: number, dstOperatorIx: number, val: number) => {
          if (!this.awpHandle) {
            console.error('Tried to update modulation before AWP initialization');
            return;
          }

          this.awpHandle.port.postMessage({
            type: 'setModulationIndex',
            srcOperatorIx,
            dstOperatorIx,
            valueType: 1,
            valParamInt: 0,
            valParamFloat: val,
          });
        },
        updateBackendOutput: (operatorIx: number, val: number) => {
          if (!this.awpHandle) {
            console.error('Tried to update output weights before AWP initialization');
            return;
          }

          this.awpHandle.port.postMessage({
            type: 'setOutputWeightValue',
            operatorIx,
            valueType: 1,
            valParamInt: 0,
            valParamFloat: val,
          });
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
        valParamFloat: 1,
      });
      this.awpHandle!.port.postMessage({
        type: 'setModulationIndex',
        srcOperatorIx: 1,
        dstOperatorIx: 0,
        valueType: 0,
        valParamInt: 0,
        valParamFloat: 0,
      });
      // this.awpHandle!.port.postMessage({
      //   type: 'setModulationIndex',
      //   srcOperatorIx: 1,
      //   dstOperatorIx: 0,
      //   valueType: 1,
      //   valParamInt: 0,
      //   valParamFloat: 400,
      // });
      // this.awpHandle!.port.postMessage({
      //   type: 'setModulationIndex',
      //   srcOperatorIx: 1,
      //   dstOperatorIx: 1,
      //   valueType: 1,
      //   valParamInt: 0,
      //   valParamFloat: 400,
      // });
      this.awpHandle!.port.postMessage({
        type: 'setOperatorBaseFrequencySource',
        operatorIx: 1,
        valueType: 3,
        valParamInt: 0,
        valParamFloat: 4,
      });
      this.awpHandle!.port.postMessage({
        type: 'setOperatorBaseFrequencySource',
        operatorIx: 2,
        valueType: 3,
        valParamInt: 0,
        valParamFloat: 4,
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
    console.log(this.awpHandle?.parameters);
    return {
      // TODO: include all generated inputs
      inputs: ImmMap<string, ConnectableInput>()
        .set('frequency', {
          type: 'number',
          node: this.awpHandle
            ? (this.awpHandle.parameters as any).get('base_frequency')
            : new DummyNode(),
        })
        .set('param_0', {
          type: 'number',
          node: this.awpHandle ? (this.awpHandle.parameters as any).get('0') : new DummyNode(),
        }),
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
