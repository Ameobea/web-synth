import { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';
import { type MIDIInputCbs, MIDINode, type MIDINoteMetadata } from 'src/patchNetwork/midiNode';
import { getSample, hashSampleDescriptor, type SampleDescriptor } from 'src/sampleLibrary';
import type { SamplerSelection, SerializedSampler } from 'src/sampler/sampler';
import { AsyncOnce, UnreachableError, delay, getEngine } from 'src/util';
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
  private midiAttackCBs: ((midiNumber: number) => void)[] = [];
  private isShutdown = false;
  private midiGateStatusBufferI32: Int32Array | null = null;
  private midiGateStatusLoopStarted = false;

  public midiNode: MIDINode;
  public awpHandle: AudioWorkletNode | null = null;
  public activeSample: Writable<ActiveSampleData | null> = writable(null);
  public selections: Writable<SamplerSelection[]>;
  public activeSelectionIx: Writable<number | null>;
  public midiGateStatusBufferF32: Float32Array | null = null;
  public waveformRenderer: WaveformRenderer;
  public midiGateStatusUpdated = writable(0);

  constructor(vcId: string, initialState: SerializedSampler) {
    this.vcId = vcId;
    this.audioThreadMIDIEventMailboxID = `sampler-${vcId}-${genRandomStringID()}`;
    this.midiInputCBs = {
      enableRxAudioThreadScheduling: { mailboxIDs: [this.audioThreadMIDIEventMailboxID] },
      onAttack: () => {
        throw new UnreachableError('Expected only audio thread MIDI events');
      },
      onRelease: () => {
        throw new UnreachableError('Expected only audio thread MIDI events');
      },
      onClearAll: () => {
        throw new UnreachableError('Expected only audio thread MIDI events');
      },
      onPitchBend: () => {
        throw new UnreachableError('Expected only audio thread MIDI events');
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

    this.updateMIDINodeMetadata();

    this.init();
  }

  private async init() {
    const [samplerWasm] = await Promise.all([SamplerWasm.get(), SamplerAWPRegistered.get()]);
    this.awpHandle = new AudioWorkletNode(ctx, 'sampler-awp', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: { mailboxID: this.audioThreadMIDIEventMailboxID },
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.awpHandle.port.postMessage({ type: 'setWasmBytes', wasmBytes: samplerWasm });
    this.awpHandle.port.onmessage = e => this.handleAWPMessage(e.data);
    this.setSelectedSample(get(this.activeSample)?.descriptor ?? null);
    for (const selection of get(this.selections)) {
      this.commitSelection(selection);
    }

    updateConnectables(this.vcId, getEngine()!.get_vc_connectables(this.vcId));
  }

  private handleAWPMessage(msg: any) {
    switch (msg.type) {
      case 'midiAttack':
        this.midiAttackCBs.forEach(cb => cb(msg.midiNumber));
        this.midiAttackCBs = [];
        break;
      case 'midiGateStatusSAB':
        this.midiGateStatusBufferF32 = new Float32Array(msg.midiGateStatusSAB);
        this.midiGateStatusBufferI32 = new Int32Array(msg.midiGateStatusSAB);
        if (!this.midiGateStatusLoopStarted) {
          this.startMidiGateStatusLoop();
        }
        break;
      default:
        console.error('Unhandled message type from sampler AWP: ', msg);
    }
  }

  private startMidiGateStatusLoop() {
    this.midiGateStatusLoopStarted = true;
    const bufI32 = this.midiGateStatusBufferI32!;

    setTimeout(async () => {
      while (!this.isShutdown) {
        const { async, value } = Atomics.waitAsync(bufI32, 512, 0);
        await value;
        this.midiGateStatusUpdated.update(n => n + 1);
        if (!async) {
          await delay(5);
        }
      }
    });
  }

  public async setSelectedSample(descriptor: SampleDescriptor | null) {
    if (!descriptor) {
      this.activeSample.set(null);
      this.activeSelectionIx.set(null);
      this.selections.set([]);
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

  /**
   * Sends a selection to the audio thread
   */
  private commitSelection(selection: SamplerSelection) {
    if (!this.awpHandle || typeof selection.midiNumber !== 'number') {
      return;
    }

    this.awpHandle.port.postMessage({
      type: 'setSelection',
      selection: {
        midiNumber: selection.midiNumber,
        startSampleIx: selection.startSampleIx,
        endSampleIx: selection.endSampleIx,
        crossfadeStartLenSamples: selection.startCrossfadeLenSamples,
        crossfadeEndLenSamples: selection.endCrossfadeLenSamples,
        playbackRate: selection.playbackRate,
        reverse: selection.reverse ?? false,
      },
    });
  }

  public deleteSelection(ix: number) {
    const selections = get(this.selections);
    const activeSelectionIx = get(this.activeSelectionIx);
    if (ix === activeSelectionIx) {
      this.activeSelectionIx.set(null);
    }

    const oldSelection = selections[ix];
    this.selections.set([
      ...selections.slice(0, ix),
      ...selections.slice(ix + 1, selections.length),
    ]);

    if (typeof oldSelection.midiNumber === 'number') {
      this.awpHandle?.port.postMessage({
        type: 'clearSelection',
        midiNumber: oldSelection.midiNumber,
      });
    }
  }

  public setSelection(ix: number, newSelection: SamplerSelection) {
    const selections = get(this.selections);
    if (!selections[ix]) {
      throw new Error(`Selection at index ${ix} does not exist`);
    }

    const nameChanged = selections[ix].name !== newSelection.name;
    const midiNumberChanged = selections[ix].midiNumber !== newSelection.midiNumber;

    const newSelections = [...selections];
    newSelections[ix] = newSelection;
    this.selections.set(newSelections);

    this.commitSelection(newSelection);

    if (nameChanged || midiNumberChanged) {
      this.updateMIDINodeMetadata();
    }
  }

  private updateMIDINodeMetadata() {
    const selections = get(this.selections);
    const newNoteMetadata: Map<number, MIDINoteMetadata> = new Map();

    for (const selection of selections) {
      if (typeof selection.midiNumber === 'number') {
        newNoteMetadata.set(selection.midiNumber, {
          active: true,
          name: selection.name || undefined,
        });
      }
    }

    this.midiNode.metadata.update(metadata => ({ ...metadata, noteMetadata: newNoteMetadata }));
  }

  /**
   * Listens for incoming MIDI events and returns the MIDI number of the first attack event received.
   */
  public captureNextMIDIAttack(): Promise<number> {
    return new Promise<number>(resolve => {
      if (!this.awpHandle) {
        throw new Error('Cannot capture MIDI attacks before AWP initialized');
      }

      this.midiAttackCBs.push(resolve);

      this.awpHandle.port.postMessage({ type: 'captureNextMIDIAttack' });
    });
  }

  public serialize(): SerializedSampler {
    return {
      activeSample: get(this.activeSample)?.descriptor || null,
      selections: get(this.selections),
      activeSelectionIx: get(this.activeSelectionIx),
    };
  }

  public shutdown() {
    this.isShutdown = true;
    if (this.awpHandle) {
      this.awpHandle.port.postMessage({ type: 'shutdown' });
      this.awpHandle.disconnect();
    }
  }
}
