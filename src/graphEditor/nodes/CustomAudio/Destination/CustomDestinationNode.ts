import { get, writable, type Writable } from 'svelte/store';
import { Map as ImmMap } from 'immutable';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import CustomDestinationNodeSmallView from './DestinationNodeSmallView.svelte';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { AsyncOnce } from 'src/util';

const SafetyLimiterAWPInitialized = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'SafetyLimiterAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);
const SafetyLimiterWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'safety_limiter.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

export interface CustomDestinationNodeState {
  safetyLimiterEnabled: boolean;
}

const buildDefaultCustomDestinationNodeState = (): CustomDestinationNodeState => ({
  safetyLimiterEnabled: true,
});

export class CustomDestinationNode extends GainNode implements ForeignNode {
  private ctx: AudioContext;
  private globalVolumeNode: GainNode;
  private vcId: string | undefined;
  private safetyLimiterAWPHandle: AudioWorkletNode | null = null;
  private safetyLimiterConnected = false;
  private state: Writable<CustomDestinationNodeState> = writable(
    buildDefaultCustomDestinationNodeState()
  );
  private sab = writable<Float32Array | null>(null);

  static typeName = 'Destination';
  public nodeType = 'customAudio/destination';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    super(ctx);
    this.ctx = ctx;
    this.globalVolumeNode = (this.ctx as any).globalVolume as GainNode;
    this.vcId = vcId;
    this.connect(this.globalVolumeNode);

    if (params) {
      this.state.set({
        ...buildDefaultCustomDestinationNodeState(),
        ...(params as CustomDestinationNodeState),
      });
    }

    this.init();

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: CustomDestinationNodeSmallView,
      getProps: () => ({ state: this.state, node: this, sab: this.sab }),
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const state = get(this.state);
    this.setSafetyLimiterEnabled(state.safetyLimiterEnabled);
  }

  // prevent `setSafetyLimiterEnabled` from being called multiple times in parallel
  private setSafetyLimiterEnabledCalling = false;
  private setSafetyLimiterEnabledQueue: boolean[] = [];

  private handleAWPMessage(evt: MessageEvent) {
    if (evt.data.type === 'sab') {
      this.sab.set(new Float32Array(evt.data.sab));
    }
  }

  public async setSafetyLimiterEnabled(enabled: boolean) {
    if (this.setSafetyLimiterEnabledCalling) {
      this.setSafetyLimiterEnabledQueue.push(enabled);
      return;
    }
    this.setSafetyLimiterEnabledCalling = true;

    if (enabled && !this.safetyLimiterConnected) {
      this.safetyLimiterConnected = true;
      if (!this.safetyLimiterAWPHandle) {
        const [wasmBytes] = await Promise.all([
          SafetyLimiterWasm.get(),
          SafetyLimiterAWPInitialized.get(),
        ]);
        this.safetyLimiterAWPHandle = new AudioWorkletNode(this.context, 'safety-limiter-awp', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelInterpretation: 'discrete',
          channelCountMode: 'explicit',
        });
        this.safetyLimiterAWPHandle.port.onmessage = evt => this.handleAWPMessage(evt);
        this.safetyLimiterAWPHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });

        this.safetyLimiterAWPHandle.connect(this.globalVolumeNode, 0, 0);
      }

      try {
        this.disconnect(this.globalVolumeNode);
      } catch (err) {
        console.warn(
          'Error disconnecting global destination from global volume even though we thought it was connected',
          err
        );
      }

      this.connect(this.safetyLimiterAWPHandle, 0, 0);
    } else if (!enabled && this.safetyLimiterConnected) {
      this.safetyLimiterConnected = false;
      if (this.safetyLimiterAWPHandle) {
        try {
          this.disconnect(this.safetyLimiterAWPHandle, 0, 0);
        } catch (err) {
          console.warn('Error disconnecting safety limiter from global volume', err);
        }
      }

      this.connect(this.globalVolumeNode, 0, 0);
    }

    this.setSafetyLimiterEnabledCalling = false;
    if (this.setSafetyLimiterEnabledQueue.length > 0) {
      const nextEnabled = this.setSafetyLimiterEnabledQueue.shift()!;
      await this.setSafetyLimiterEnabled(nextEnabled);
    }
  }

  public serialize(): { [key: string]: any } {
    return get(this.state);
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>().set('input', { type: 'customAudio', node: this }),
      outputs: ImmMap<string, ConnectableOutput>(),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
