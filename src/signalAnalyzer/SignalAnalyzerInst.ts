import { get, Writable, writable } from 'svelte/store';

import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';
import { LineSpectrogram } from 'src/visualizations/LineSpectrogram/LineSpectrogram';
import {
  buildDefaultLineSpecrogramUIState,
  LineSpectrogramUIState,
} from 'src/visualizations/LineSpectrogram/types';
import { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';
import {
  buildDefaultOscilloscopeUIState,
  OscilloscopeUIState,
} from 'src/visualizations/Oscilloscope/types';

const ctx = new AudioContext();
const SignalAnalyzerAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'SignalAnalyzerAWP.js?cacheBust=' +
        (window.location.href.includes('localhost') ? '' : crypto.randomUUID())
    ),
  true
);

export interface SerializedSignalAnalyzerInst {
  oscilloscopeUIState: OscilloscopeUIState;
  lineSpectrogramUIState: LineSpectrogramUIState;
}

export const buildDefaultSignalAnalyzerInstState = (): SerializedSignalAnalyzerInst => ({
  oscilloscopeUIState: buildDefaultOscilloscopeUIState(),
  lineSpectrogramUIState: buildDefaultLineSpecrogramUIState(),
});

export class SignalAnalyzerInst {
  public input: AnalyserNode;
  private awpHandle: AudioWorkletNode | null = null;
  public oscilloscope: Oscilloscope;
  public lineSpectrogram: LineSpectrogram;
  // Need to connect the analyzer AWP to the audio graph so it gets driven
  private silentGain: GainNode;
  public oscilloscopeUIState: Writable<OscilloscopeUIState>;

  constructor(ctx: AudioContext, initialState: SerializedSignalAnalyzerInst) {
    this.oscilloscopeUIState = writable(initialState.oscilloscopeUIState);
    this.input = ctx.createAnalyser();
    this.input.fftSize = 4096;
    this.silentGain = ctx.createGain();
    this.silentGain.gain.value = 0;
    this.silentGain.connect(ctx.destination);
    this.oscilloscope = new Oscilloscope(initialState.oscilloscopeUIState);

    this.lineSpectrogram = new LineSpectrogram(initialState.lineSpectrogramUIState, this.input);

    this.init().catch(err => {
      logError('Error initializing signal analyzer', err);
    });
  }

  private handleAWPMessage = (e: MessageEvent) => {
    switch (e.data.type) {
      case 'setSAB':
        this.oscilloscope.setSAB(e.data.sab);
        break;
      default:
        console.warn(`Unknown message type from signal analyzer AWP: ${(e.data as any).type}`);
    }
  };

  private async init() {
    await SignalAnalyzerAWPRegistered.get();
    this.awpHandle = new AudioWorkletNode(ctx, 'signal-analyzer-awp');
    this.awpHandle.port.onmessage = this.handleAWPMessage;
    this.input.connect(this.awpHandle);
    this.awpHandle.connect(this.silentGain);

    // We need to make sure the AWP doesn't send the SAB before we register our even listener
    this.awpHandle.port.postMessage({ type: 'sendSAB' });
  }

  public pause() {
    this.oscilloscope.pause();
    this.lineSpectrogram.stop();
  }

  public resume() {
    this.oscilloscope.resume();
    this.lineSpectrogram.start();
  }

  public serialize(): SerializedSignalAnalyzerInst {
    return {
      oscilloscopeUIState: get(this.oscilloscopeUIState),
      lineSpectrogramUIState: this.lineSpectrogram.serialize(),
    };
  }

  public destroy() {
    this.oscilloscope.destroy();
    if (this.awpHandle) {
      this.awpHandle.port.close();
      this.awpHandle.disconnect();
    }
    this.input.disconnect();
    this.silentGain.disconnect();
  }
}
