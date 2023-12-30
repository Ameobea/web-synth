import { MIDINode } from 'src/patchNetwork/midiNode';
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
  public midiNode: MIDINode;
  public awpHandle: AudioWorkletNode | null = null;
  public activeSample: Writable<{
    descriptor: SampleDescriptor;
    sampleData: AudioBuffer | null;
  } | null> = writable(null);

  constructor(vcId: string, initialState: SerializedSampler) {
    this.vcId = vcId;
    this.midiNode = new MIDINode();
    this.setSelectedSample(initialState.activeSample);

    this.init();
  }

  private async init() {
    const [samplerWasm] = await Promise.all([SamplerWasm.get(), SamplerAWPRegistered.get()]);
    this.awpHandle = new AudioWorkletNode(ctx, 'sampler-awp', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes: samplerWasm });

    updateConnectables(this.vcId, getEngine()!.get_vc_connectables(this.vcId));
  }

  public async setSelectedSample(descriptor: SampleDescriptor | null) {
    if (!descriptor) {
      this.activeSample.set(null);
      return;
    }

    this.activeSample.set({ descriptor, sampleData: null });
    try {
      const sampleData = await getSample(descriptor);
      this.activeSample.set({ descriptor, sampleData });

      // if the selected sample changed in the meantime, abort
      const curActiveSample = get(this.activeSample);
      if (
        !curActiveSample ||
        hashSampleDescriptor(curActiveSample.descriptor) !== hashSampleDescriptor(descriptor)
      ) {
        this.activeSample.set(null);
        return;
      }
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
