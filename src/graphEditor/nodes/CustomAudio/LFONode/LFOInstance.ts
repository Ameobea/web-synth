import { Map as ImmMap } from 'immutable';

import { AsyncOnce, rwritable, UnimplementedError, type TransparentWritable } from 'src/util';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioNode } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import type { LegacyLFOParams, LFONode } from './LFONode';
import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';

export enum OscillatorType {
  Sine = 'sine',
  Triangle = 'triangle',
  Square = 'square',
  Sawtooth = 'sawtooth',
}

export type OscillatorConfig =
  | { type: OscillatorType.Sine }
  | { type: OscillatorType.Triangle }
  | { type: OscillatorType.Sawtooth }
  | { type: OscillatorType.Square; dutyCycle?: number };

export interface PhaseInitConfig {
  setPhaseOnPlaybackStart: boolean;
  startPhase: number;
}

export interface LFOConfig {
  oscillator: OscillatorConfig;
  frequency: number;
  phaseInit: PhaseInitConfig;
}

export const buildDefaultLFOConfig = (): LFOConfig => ({
  oscillator: { type: OscillatorType.Sine },
  frequency: 1,
  phaseInit: {
    setPhaseOnPlaybackStart: true,
    startPhase: 0,
  },
});

const LFOAWPInitialized = new AsyncOnce(
  () =>
    new AudioContext().audioWorklet.addModule(
      process.env.ASSET_PATH +
        'LFOAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);
const LFOWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'lfo.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

const normalizeState = (state: LFOConfig | LegacyLFOParams): LFOConfig => {
  if ('waveform' in state) {
    if (state.waveform === 'custom') {
      throw new UnimplementedError();
    }

    return {
      oscillator: {
        type: {
          sine: OscillatorType.Sine,
          triangle: OscillatorType.Triangle,
          sawtooth: OscillatorType.Sawtooth,
          square: OscillatorType.Square,
        }[state.waveform],
      },
      frequency: state.frequency,
      phaseInit: { startPhase: 0, setPhaseOnPlaybackStart: false },
    };
  }
  return state;
};

export class LFOInstance {
  private ctx: AudioContext;
  private lfoNode: LFONode;
  public readonly vcId: string;

  private freqOAN: OverridableAudioNode;
  private awp: AudioWorkletNode | DummyNode = new DummyNode('lfo');
  private ready = false;

  public readonly phaseSAB: TransparentWritable<Float32Array | null> = rwritable(null);
  public readonly state: TransparentWritable<LFOConfig>;

  constructor(
    ctx: AudioContext,
    vcId: string,
    lfoNode: LFONode,
    initialOsc: LFOConfig | LegacyLFOParams
  ) {
    this.ctx = ctx;
    this.lfoNode = lfoNode;
    this.vcId = vcId;
    this.state = rwritable(normalizeState(initialOsc));
    this.freqOAN = new OverridableAudioNode(ctx, undefined, true);
    this.freqOAN.manualControl.offset.value = this.state.current.frequency;
    this.init();
  }

  public setOscillatorConfig(cfg: OscillatorConfig) {
    this.state.update(state => ({ ...state, oscillator: cfg }));

    if (this.ready && this.awp instanceof AudioWorkletNode) {
      const { oscType, param0 } = this.encodeLFOConfig(cfg);
      this.awp.port.postMessage({ type: 'setOscillator', oscType, param0 });
    }
  }

  public setPhaseInitConfig(cfg: PhaseInitConfig) {
    this.state.update(state => ({ ...state, phaseInit: cfg }));

    if (this.ready && this.awp instanceof AudioWorkletNode) {
      this.awp.port.postMessage({ type: 'setPhaseInit', phaseInit: cfg });
    }
  }

  public setManualFrequency(freq: number) {
    this.state.update(state => ({ ...state, frequency: freq }));
    this.freqOAN.manualControl.offset.value = freq;
  }

  public buildAudioConnectables(): AudioConnectables & { node: ForeignNode } {
    return {
      vcId: this.vcId,
      inputs: ImmMap<string, ConnectableInput>().set('frequency', {
        type: 'number',
        node: this.freqOAN,
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('signal', {
        type: 'number',
        node: this.awp,
      }),
      node: this.lfoNode,
    };
  }

  public shutdown() {
    if (this.awp instanceof AudioWorkletNode) {
      this.awp.port.postMessage({ type: 'shutdown' });
    }
  }

  private async init() {
    const [wasmBytes] = await Promise.all([LFOWasm.get(), LFOAWPInitialized.get()]);

    this.awp = new AudioWorkletNode(this.ctx, 'lfo-awp', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });

    const freqParam = (this.awp.parameters as Map<string, AudioParam>).get('frequency')!;
    this.freqOAN.output.connect(freqParam);

    this.awp.port.onmessage = evt => this.handleAWPMessage(evt);

    this.awp.port.postMessage({ type: 'setWasmBytes', wasmBytes });

    updateConnectables(this.vcId, this.buildAudioConnectables());
  }

  private handleAWPMessage(evt: MessageEvent) {
    switch (evt.data.type) {
      case 'ready': {
        this.ready = true;
        this.setPhaseInitConfig(this.state.current.phaseInit);
        this.setOscillatorConfig(this.state.current.oscillator);
        break;
      }
      case 'setPhaseSAB':
        this.phaseSAB.set(evt.data.sab);
        break;
      default:
        console.warn('Unknown msg from LFOAWP:', evt.data);
    }
  }

  private encodeLFOConfig(cfg: OscillatorConfig): { oscType: number; param0: number } {
    switch (cfg.type) {
      case OscillatorType.Sine:
        return { oscType: 0, param0: 0 };
      case OscillatorType.Triangle:
        return { oscType: 1, param0: 0 };
      case OscillatorType.Sawtooth:
        return { oscType: 3, param0: 0 };
      case OscillatorType.Square:
        return { oscType: 2, param0: cfg.dutyCycle ?? 0.5 };
      default:
        cfg satisfies never;
        throw new Error(`Unhandled LFO type: ${(cfg as any).type}`);
    }
  }
}
