import { UnreachableException } from 'ameo-utils';
import { type MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';
import { getSample, hashSampleDescriptor, type SampleDescriptor } from 'src/sampleLibrary';
import type { SerializedSampler } from 'src/sampler/sampler';
import { AsyncOnce, getEngine } from 'src/util';
import { type Writable, writable, get } from 'svelte/store';

const ctx = new AudioContext();
const SamplerAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'SamplerAWP.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

const SamplerWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'sampler.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ).then(res => res.arrayBuffer()),
  true
);

export class SamplerInstance {
  private vcId: string;
  private audioThreadMIDIEventMailboxID: string;
  private midiInputCBs: MIDIInputCbs;
  public midiNode: MIDINode;
  public awpHandle: AudioWorkletNode | null = null;
  public activeSample: Writable<{
    descriptor: SampleDescriptor;
    sampleData: AudioBuffer | null;
  } | null> = writable(null);

  constructor(vcId: string, initialState: SerializedSampler) {
    this.vcId = vcId;
    this.audioThreadMIDIEventMailboxID = `sampler-${vcId}-${genRandomStringID()}`;
    this.midiInputCBs = {
      enableRxAudioThreadScheduling: { mailboxIDs: [this.audioThreadMIDIEventMailboxID] },
      onAttack: () => {
        throw new UnreachableException('Expected only audio thread MIDI events');
      },
      onRelease: () => {
        throw new UnreachableException('Expected only audio thread MIDI events');
      },
      onClearAll: () => {
        throw new UnreachableException('Expected only audio thread MIDI events');
      },
      onPitchBend: () => {
        throw new UnreachableException('Expected only audio thread MIDI events');
      },
    };
    this.midiNode = new MIDINode(() => this.midiInputCBs);
    this.setSelectedSample(initialState.activeSample);

    this.init();
  }

  private async init() {
    const [samplerWasm] = await Promise.all([SamplerWasm.get(), SamplerAWPRegistered.get()]);
    this.awpHandle = new AudioWorkletNode(ctx, 'sampler-awp', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { mailboxID: this.audioThreadMIDIEventMailboxID },
    });
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes: samplerWasm });
    this.setSelectedSample(get(this.activeSample)?.descriptor ?? null);

    updateConnectables(this.vcId, getEngine()!.get_vc_connectables(this.vcId));
  }

  public async setSelectedSample(descriptor: SampleDescriptor | null) {
    if (!descriptor) {
      this.activeSample.set(null);
      this.awpHandle?.port.postMessage({ type: 'setSampleData', sampleData: new Float32Array() });
      return;
    }

    this.activeSample.set({ descriptor, sampleData: null });
    try {
      const sampleData: AudioBuffer = await getSample(descriptor);

      // if the selected sample changed while the data was loading, abort
      const curActiveSample = get(this.activeSample);
      if (
        !curActiveSample ||
        hashSampleDescriptor(curActiveSample.descriptor) !== hashSampleDescriptor(descriptor)
      ) {
        this.activeSample.set(null);
        return;
      }

      this.activeSample.set({ descriptor, sampleData });
      const sampleDataBuffer = sampleData.getChannelData(0);
      this.awpHandle?.port.postMessage({ type: 'setSampleData', sampleData: sampleDataBuffer });
    } catch (err) {
      console.error('Error loading sample: ', err);
      alert('Error loading sample: ' + err);

      // If the selected sample hasn't changed, clear it
      const curActiveSample = get(this.activeSample);
      if (
        curActiveSample &&
        hashSampleDescriptor(curActiveSample.descriptor) === hashSampleDescriptor(descriptor)
      ) {
        this.activeSample.set(null);
      }
    }
  }

  public serialize(): SerializedSampler {
    return {
      activeSample: get(this.activeSample)?.descriptor || null,
    };
  }

  public shutdown() {
    if (this.awpHandle) {
      this.awpHandle.port.postMessage({ type: 'shutdown' });
      this.awpHandle.disconnect();
    }
  }
}
