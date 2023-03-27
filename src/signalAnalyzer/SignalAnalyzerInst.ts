import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';
import { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';

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

export class SignalAnalyzerInst {
  public input: AnalyserNode;
  private awpHandle: AudioWorkletNode | null = null;
  public oscilloscope: Oscilloscope;
  // Need to connect the analyzer AWP to the audio graph so it gets driven
  private silentGain: GainNode;

  constructor(ctx: AudioContext) {
    this.input = ctx.createAnalyser();
    this.input.fftSize = 4096;
    this.silentGain = ctx.createGain();
    this.silentGain.gain.value = 0;
    this.silentGain.connect(ctx.destination);
    this.oscilloscope = new Oscilloscope();

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
    console.log('pause');
    this.oscilloscope.pause();
  }

  public resume() {
    console.log('resume');
    this.oscilloscope.resume();
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
