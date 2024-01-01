import { Map as ImmMap } from 'immutable';
import { isNil } from 'ramda';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import { DelaySmallView } from 'src/graphEditor/nodes/CustomAudio/Delay/DelayUI';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { getSentry } from 'src/sentry';
import { AsyncOnce } from 'src/util';

const DelayWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'delay.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ).then(res => res.arrayBuffer()),
  true
);
const DelayAWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'DelayAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

interface DelayParams {
  delayMs: OverridableAudioParam | DummyNode;
  delayGain: OverridableAudioParam | DummyNode;
  feedback: OverridableAudioParam | DummyNode;
  highpassCutoff: OverridableAudioParam | DummyNode;
}

export default class DelayNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private awpHandle: AudioWorkletNode | null = null;
  private delayOutput: GainNode;
  private cachedParamValues = {
    delayMs: 800,
    delayGain: 0.9,
    feedback: 0.2,
    highpassCutoff: 80,
  };
  private params: DelayParams = {
    delayMs: new DummyNode(),
    delayGain: new DummyNode(),
    feedback: new DummyNode(),
    highpassCutoff: new DummyNode(),
  };

  static typeName = 'Delay';
  public nodeType = 'customAudio/delay';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.delayOutput = ctx.createGain();
    this.delayOutput.gain.value = 1;

    if (params) {
      this.deserialize(params);
    }

    this.init().catch(err => {
      console.error('Error initializing Delay node:', err);
      getSentry()?.captureException(err);
    });

    this.renderSmallView = mkContainerRenderHelper({
      Comp: DelaySmallView,
      getProps: () => ({
        getInitialParams: this.getManualParamValues,
        onChange: this.handleManualParamChange,
      }),
    });
    this.cleanupSmallView = mkContainerCleanupHelper({ preserveRoot: true });
  }

  private handleManualParamChange = (
    rawKey: 'delay ms' | 'delay gain' | 'feedback',
    value: number
  ) => {
    const key: keyof DelayParams = {
      'delay ms': 'delayMs' as const,
      'delay gain': 'delayGain' as const,
      feedback: 'feedback' as const,
      'highpass cutoff freq': 'highpassCutoff' as const,
    }[rawKey];

    this.cachedParamValues[key] = value;
    const maybeOAP = this.params[key];
    if (maybeOAP instanceof OverridableAudioParam) {
      maybeOAP.manualControl.offset.value = value;
    }
  };

  private getManualParamValues = (): {
    delayMs: number;
    delayGain: number;
    feedback: number;
    highpassCutoff: number;
  } => {
    return {
      delayMs:
        this.params.delayMs instanceof OverridableAudioParam
          ? this.params.delayMs.manualControl.offset.value
          : this.cachedParamValues.delayMs,
      delayGain:
        this.params.delayGain instanceof OverridableAudioParam
          ? this.params.delayGain.manualControl.offset.value
          : this.cachedParamValues.delayGain,
      feedback:
        this.params.feedback instanceof OverridableAudioParam
          ? this.params.feedback.manualControl.offset.value
          : this.cachedParamValues.feedback,
      highpassCutoff:
        this.params.highpassCutoff instanceof OverridableAudioParam
          ? this.params.highpassCutoff.manualControl.offset.value
          : this.cachedParamValues.highpassCutoff,
    };
  };

  private async init() {
    const [wasmBytes] = await Promise.all([
      DelayWasmBytes.get(),
      DelayAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'delay-awp', {
      numberOfOutputs: 2,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.awpHandle.connect(this.delayOutput, 1);

    this.params.delayMs = new OverridableAudioParam(
      this.ctx,
      (this.awpHandle.parameters as Map<string, AudioParam>).get('delay ms')!
    );
    this.params.delayMs.manualControl.offset.value = this.cachedParamValues.delayMs;
    this.params.delayGain = new OverridableAudioParam(
      this.ctx,
      (this.awpHandle.parameters as Map<string, AudioParam>).get('delay gain')!
    );
    this.params.delayGain.manualControl.offset.value = this.cachedParamValues.delayGain;
    this.params.feedback = new OverridableAudioParam(
      this.ctx,
      (this.awpHandle.parameters as Map<string, AudioParam>).get('feedback')!
    );
    this.params.feedback.manualControl.offset.value = this.cachedParamValues.feedback;
    this.params.highpassCutoff = new OverridableAudioParam(
      this.ctx,
      (this.awpHandle.parameters as Map<string, AudioParam>).get('highpass cutoff freq')!
    );
    this.params.highpassCutoff.manualControl.offset.value = this.cachedParamValues.highpassCutoff;

    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });

    if (!isNil(this.vcId)) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private deserialize(params: { [key: string]: any }) {
    if (!isNil(params.delayMs)) {
      this.cachedParamValues.delayMs = params.delayMs;
    }
    if (!isNil(params.delayGain)) {
      this.cachedParamValues.delayGain = params.delayGain;
    }
    if (!isNil(params.feedback)) {
      this.cachedParamValues.feedback = params.feedback;
    }
    if (!isNil(params.highpassCutoff)) {
      this.cachedParamValues.highpassCutoff = params.highpassCutoff;
    }
  }

  public serialize() {
    return { ...this.cachedParamValues };
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>()
        .set('input', {
          type: 'customAudio',
          node: this.awpHandle ? this.awpHandle : new DummyNode(),
        })
        .set('delay ms', {
          type: 'number',
          node: this.params.delayMs,
        })
        .set('delay gain', {
          type: 'number',
          node: this.params.delayGain,
        })
        .set('feedback', {
          type: 'number',
          node: this.params.feedback,
        })
        .set('highpass cutoff freq', {
          type: 'number',
          node: this.params.highpassCutoff,
        }),
      outputs: ImmMap<string, ConnectableOutput>()
        .set('output', {
          type: 'customAudio',
          node: this.awpHandle ? this.awpHandle : new DummyNode(),
        })
        .set('delay output', {
          type: 'customAudio',
          node: this.delayOutput,
        }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
