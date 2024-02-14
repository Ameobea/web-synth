import { Map as ImmMap } from 'immutable';
import { get, writable, type Writable } from 'svelte/store';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { getSentry } from 'src/sentry';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce } from 'src/util';
import LevelDetectorNodeSmallView from './LevelDetectorNodeSmallView.svelte';

export const LevelDetectorWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'level_detector.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);
const LevelDetectorAWPRegistered = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'LevelDetectorAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : genRandomStringID())
    ),
  true
);

export interface LevelDetectorNodeState {
  windowSizeSamples: number;
}

const buildDefaultState = (): LevelDetectorNodeState => ({
  windowSizeSamples: 44_100 / 20,
});

export class LevelDetectorNode implements ForeignNode {
  private vcId: string | undefined;
  private ctx: AudioContext;
  private awpHandle: AudioWorkletNode | undefined;
  private detectedLevelSAB: Writable<Float32Array | null> = writable(null);
  private dummyInput = new DummyNode();
  private state: Writable<LevelDetectorNodeState>;
  private windowSizeSamples: OverridableAudioParam | DummyNode = new DummyNode();

  static typeName = 'Level Detector';
  public nodeType = 'customAudio/levelDetector';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    this.state = writable(this.deserialize(params));

    this.init().catch(err => {
      console.error(`Error initializing ${LevelDetectorNode.typeName} node:`, err);
      getSentry()?.captureException(err);
    });

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: LevelDetectorNodeSmallView,
      getProps: () => ({
        state: this.state,
        detectedLevelSAB: this.detectedLevelSAB,
        onChange: (newState: LevelDetectorNodeState) => this.state.set(newState),
      }),
    });
    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      LevelDetectorWasmBytes.get(),
      LevelDetectorAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'level-detector-awp', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    const awpParams = this.awpHandle.parameters as Map<string, AudioParam>;
    this.windowSizeSamples = new OverridableAudioParam(
      this.ctx,
      awpParams.get('window_size_samples')!,
      undefined,
      true
    );
    this.windowSizeSamples.manualControl.offset.value = get(this.state).windowSizeSamples;
    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }

    this.awpHandle.port.postMessage({
      type: 'setWasmBytes',
      wasmBytes,
    });
    this.awpHandle.port.onmessage = e => {
      if (typeof e.data !== 'object') {
        console.error('Received non-object message from LevelDetectorAWP:', e.data);
        return;
      }
      switch (e.data.type) {
        case 'detectedLevelSAB':
          this.detectedLevelSAB.set(new Float32Array(e.data.sab as SharedArrayBuffer));
          break;
        default:
          console.error('Received unknown message type from LevelDetectorAWP:', e.data.type);
      }
    };
  }

  public serialize(): LevelDetectorNodeState {
    return get(this.state);
  }

  public deserialize(params: Record<string, any> | null | undefined): LevelDetectorNodeState {
    const defaultState = buildDefaultState();
    if (!params) {
      return defaultState;
    }

    return {
      windowSizeSamples: params.windowSizeSamples ?? defaultState.windowSizeSamples,
    };
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>().set('input', {
        type: 'number',
        node: this.awpHandle ?? this.dummyInput,
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'number',
        node: this.awpHandle ?? this.dummyInput,
      }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
