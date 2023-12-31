import { UnreachableException } from 'ameo-utils';
import { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';
import { type MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';
import { getSample, hashSampleDescriptor, type SampleDescriptor } from 'src/sampleLibrary';
import type { SamplerSelection, SerializedSampler } from 'src/sampler/sampler';
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

interface ActiveSampleData {
  descriptor: SampleDescriptor;
  sampleData: AudioBuffer | null;
}

export class SamplerInstance {
  private vcId: string;
  private audioThreadMIDIEventMailboxID: string;
  private midiInputCBs: MIDIInputCbs;
  public midiNode: MIDINode;
  public awpHandle: AudioWorkletNode | null = null;
  public activeSample: Writable<ActiveSampleData | null> = writable(null);
  public selections: Writable<SamplerSelection[]>;
  public activeSelectionIx: Writable<number | null>;
  public waveformRenderer: WaveformRenderer;

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
    this.activeSelectionIx = writable(initialState.activeSelectionIx);
    this.selections = writable(initialState.selections);
    this.midiNode = new MIDINode(() => this.midiInputCBs);
    this.setSelectedSample(initialState.activeSample);
    this.waveformRenderer = new WaveformRenderer();
    this.activeSample.subscribe(activeSample => {
      if (activeSample?.sampleData) {
        this.waveformRenderer.setSample(activeSample.sampleData);
      }
    });

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

  public deleteSelection(ix: number) {
    const selections = get(this.selections);
    const activeSelectionIx = get(this.activeSelectionIx);
    if (ix === activeSelectionIx) {
      this.activeSelectionIx.set(null);
    }
    this.selections.set([
      ...selections.slice(0, ix),
      ...selections.slice(ix + 1, selections.length),
    ]);

    // TODO: Update backend
  }

  public setSelection(ix: number, newSelection: SamplerSelection) {
    const selections = get(this.selections);
    if (!selections[ix]) {
      throw new Error(`Selection at index ${ix} does not exist`);
    }

    const newSelections = [...selections];
    newSelections[ix] = newSelection;
    this.selections.set(newSelections);
  }

  public serialize(): SerializedSampler {
    return {
      activeSample: get(this.activeSample)?.descriptor || null,
      selections: get(this.selections),
      activeSelectionIx: get(this.activeSelectionIx),
    };
  }

  public shutdown() {
    if (this.awpHandle) {
      this.awpHandle.port.postMessage({ type: 'shutdown' });
      this.awpHandle.disconnect();
    }
  }
}
