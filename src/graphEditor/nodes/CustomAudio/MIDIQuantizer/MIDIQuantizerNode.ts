import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import {
  registerGlobalStartCB,
  registerGlobalStopCB,
  unregisterStartCB,
  unregisterStopCB,
} from 'src/eventScheduler';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { MIDINode } from 'src/patchNetwork/midiNode';
import { getSentry } from 'src/sentry';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { AsyncOnce } from 'src/util';
import MIDIQuantizerNodeUI from './MIDIQuantizerNodeUI.svelte';
import { buildDefaultMIDIQuantizerNodeUIState, type MIDIQuantizerNodeUIState } from './types';

const MIDIQuantizerWasmBytes = new AsyncOnce(
  () => fetch(process.env.ASSET_PATH + 'midi_quantizer.wasm').then(res => res.arrayBuffer()),
  true
);

const ctx = new AudioContext();
const MIDIQuantizerAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'MIDIQuantizerAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

export default class MIDIQuantizerNode implements ForeignNode {
  private ctx: AudioContext;
  private vcId: string | undefined;
  private awpHandle: AudioWorkletNode | null = null;
  private store: Writable<MIDIQuantizerNodeUIState> = writable(
    buildDefaultMIDIQuantizerNodeUIState()
  );
  private midiNode = new MIDINode();
  private globalStartCBsRegistered = false;

  static typeName = 'MIDI Quantizer';
  public nodeType = 'customAudio/midiQuantizer';

  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  constructor(ctx: AudioContext, vcId?: string, params?: { [key: string]: any } | null) {
    this.ctx = ctx;
    this.vcId = vcId;

    if (params) {
      this.deserialize(params as MIDIQuantizerNodeUIState);
    }

    this.init().catch(err => {
      console.error('Error initializing MIDIQuantizerNode:', err);
      getSentry()?.captureException(err);
    });

    this.store.subscribe(this.onChange);

    this.renderSmallView = mkSvelteContainerRenderHelper({
      Comp: MIDIQuantizerNodeUI,
      getProps: () => ({ store: this.store }),
    });

    this.cleanupSmallView = mkSvelteContainerCleanupHelper({ preserveRoot: true });
  }

  private async init() {
    const [wasmBytes] = await Promise.all([
      MIDIQuantizerWasmBytes.get(),
      MIDIQuantizerAWPRegistered.get(),
    ] as const);
    this.awpHandle = new AudioWorkletNode(this.ctx, 'midi-quantizer', {
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes });
    this.awpHandle.port.onmessage = evt => this.handleMessage(evt.data);
    this.onChange(get(this.store));

    if (this.vcId) {
      updateConnectables(this.vcId, this.buildConnectables());
    }
  }

  private handleMessage = (data: Record<string, any>) => {
    switch (data.type) {
      case 'playNote':
        this.midiNode.onAttack(data.note, 255);
        break;
      case 'releaseNote':
        this.midiNode.onRelease(data.note, 255);
        break;
      default:
        console.error(`Unhandled message type in MIDIQuantizerNode: ${data.type}`);
    }
  };

  private onChange = (newState: MIDIQuantizerNodeUIState) => {
    if (this.globalStartCBsRegistered !== newState.startOnGlobalStart) {
      if (newState.startOnGlobalStart) {
        this.registerGlobalStartCBs();
      } else {
        this.deregisterGlobalStartCBs();
      }
    }

    this.awpHandle?.port.postMessage({ type: 'setState', state: newState });
  };

  private deserialize(params: MIDIQuantizerNodeUIState) {
    if (!params.activeNotes || !params.octaveRange) {
      return;
    }
    this.store.set(params);
  }

  private registerGlobalStartCBs = () => {
    this.globalStartCBsRegistered = true;
    registerGlobalStartCB(this.start);
    registerGlobalStopCB(this.stop);
  };

  private deregisterGlobalStartCBs = () => {
    this.globalStartCBsRegistered = false;
    unregisterStartCB(this.start);
    unregisterStopCB(this.stop);
  };

  public start = () => this.store.update(state => ({ ...state, isRunning: true }));

  public stop = () => this.store.update(state => ({ ...state, isRunning: false }));

  public serialize(): MIDIQuantizerNodeUIState {
    return R.clone(get(this.store));
  }

  public buildConnectables() {
    return {
      inputs: ImmMap<string, ConnectableInput>().set('control', {
        type: 'number',
        node: this.awpHandle
          ? (this.awpHandle.parameters as Map<string, AudioParam>).get('control')!
          : new DummyNode(),
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('midi', {
        type: 'midi',
        node: this.midiNode,
      }),
      vcId: this.vcId!,
      node: this,
    };
  }

  // These are set dynamically at initialization time in the constructor
  public renderSmallView: ForeignNode['renderSmallView'];
  public cleanupSmallView: ForeignNode['cleanupSmallView'];
}
