import { UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import { get, writable, type Writable } from 'svelte/store';

import {
  buildDefaultCVOutputState,
  CVOutput,
  type SerializedCVOutputState,
} from 'src/midiEditor/CVOutput/CVOutput';
import MIDIEditor from 'src/midiEditor/MIDIEditor';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import { MIDIEditorUIManager } from 'src/midiEditor/MIDIEditorUIManager';
import MIDIEditorPlaybackHandler from 'src/midiEditor/PlaybackHandler';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';

interface OldMIDIEditorView {
  /**
   * Zoom factor, indicating how many pixels per beat are rendered.
   */
  pxPerBeat: number;
  scrollHorizontalBeats: number;
  scrollVerticalPx: number;
  beatsPerMeasure: number;
}

interface OldSerializedMIDIEditorState {
  lines: { midiNumber: number; notes: { startPoint: number; length: number }[] }[];
  view: OldMIDIEditorView;
  beatSnapInterval: number;
  cursorPosBeats: number;
  localBPM: number;
  loopPoint: number | null;
  metronomeEnabled: boolean;
  cvOutputStates?: SerializedCVOutputState[];
}

export interface MIDIEditorBaseView {
  /**
   * Zoom factor, indicating how many pixels per beat are rendered.
   */
  pxPerBeat: number;
  scrollHorizontalBeats: number;
  beatsPerMeasure: number;
}

export interface MIDIEditorInstanceView {
  scrollVerticalPx: number;
}

export interface SerializedMIDINote {
  startPoint: number;
  length: number;
}

export interface SerializedMIDILine {
  midiNumber: number;
  notes: SerializedMIDINote[];
}

export interface SerializedMIDIEditorInstance {
  name: string;
  lines: SerializedMIDILine[];
  isActive: boolean;
  view: MIDIEditorInstanceView;
}

export interface SerializedMIDIEditorState {
  version: 2;
  scrollHorizontalBeats: number;
  instances: SerializedMIDIEditorInstance[];
  view: MIDIEditorBaseView;
  localBPM: number;
  loopPoint: number | null;
  metronomeEnabled: boolean;
  beatSnapInterval: number;
  cursorPosBeats: number;
  cvOutputStates?: SerializedCVOutputState[];
}

const buildDefaultMIDIEditorInstanceState = (): SerializedMIDIEditorInstance => {
  const maxMIDINumber = 120;
  return {
    name: 'midi',
    lines: new Array(maxMIDINumber)
      .fill(null)
      .map((_, lineIx) => ({ notes: [], midiNumber: maxMIDINumber - lineIx })),
    isActive: true,
    view: { scrollVerticalPx: 0 },
  };
};

const buildDefaultMIDIEditorState = (): SerializedMIDIEditorState => ({
  cvOutputStates: [],
  instances: [buildDefaultMIDIEditorInstanceState()],
  localBPM: 120,
  loopPoint: null,
  metronomeEnabled: true,
  scrollHorizontalBeats: 0,
  beatSnapInterval: 1,
  cursorPosBeats: 0,
  version: 2,
  view: { pxPerBeat: 32, scrollHorizontalBeats: 0, beatsPerMeasure: 4 },
});

const normalizeSerializedMIDIEditorState = (
  state: OldSerializedMIDIEditorState | SerializedMIDIEditorState
): SerializedMIDIEditorState => {
  if (!state || typeof state !== 'object') {
    console.error('Invalid MIDI editor state', state);
    return buildDefaultMIDIEditorState();
  }

  if ((state as any).version === 2) {
    return state as SerializedMIDIEditorState;
  }

  const oldState = state as OldSerializedMIDIEditorState;
  return {
    cvOutputStates: oldState.cvOutputStates || [],
    instances: [
      {
        name: 'midi',
        lines: oldState.lines,
        isActive: true,
        view: { scrollVerticalPx: oldState.view.scrollVerticalPx },
      },
    ],
    localBPM: oldState.localBPM,
    loopPoint: oldState.loopPoint,
    metronomeEnabled: oldState.metronomeEnabled,
    scrollHorizontalBeats: oldState.view.scrollHorizontalBeats,
    beatSnapInterval: oldState.beatSnapInterval,
    cursorPosBeats: oldState.cursorPosBeats,
    version: 2,
    view: {
      pxPerBeat: oldState.view.pxPerBeat,
      scrollHorizontalBeats: oldState.view.scrollHorizontalBeats,
      beatsPerMeasure: oldState.view.beatsPerMeasure,
    },
  };
};

export class MIDIEditorInstance {
  public vcId: string;
  public baseView: MIDIEditorBaseView;
  public localBPM: number;
  public loopPoint: number | null;
  public beatSnapInterval: number;
  public playbackHandler: MIDIEditorPlaybackHandler;
  public uiManager: MIDIEditorUIManager;
  private ctx: AudioContext;
  private silentOutput: GainNode;

  public cvOutputs: Writable<CVOutput[]>;

  public get uiInstance(): MIDIEditorUIInstance | undefined {
    return this.uiManager.activeUIInstance;
  }

  constructor(ctx: AudioContext, vcId: string, initialState: SerializedMIDIEditorState) {
    this.ctx = ctx;
    this.vcId = vcId;
    this.baseView = initialState.view;
    this.localBPM = initialState.localBPM;
    this.loopPoint = initialState.loopPoint;
    this.beatSnapInterval = initialState.beatSnapInterval;
    this.silentOutput = new GainNode(ctx);
    this.silentOutput.gain.value = 0;
    this.uiManager = new MIDIEditorUIManager(this, initialState);

    this.playbackHandler = new MIDIEditorPlaybackHandler(this, initialState);
    this.cvOutputs = writable(
      initialState.cvOutputStates?.map(
        state => new CVOutput(this, this.ctx, this.vcId, state.name, state, this.silentOutput)
      ) ?? []
    );
  }

  public serialize(): SerializedMIDIEditorState {
    if (!this.uiInstance) {
      throw new Error('Tried to serialize MIDI editor before UI instance initialized');
    }

    const instances = get(this.uiManager.instances).map(inst => inst.serialize());
    return {
      beatSnapInterval: this.beatSnapInterval,
      cursorPosBeats: this.getCursorPosBeats(),
      instances,
      localBPM: this.localBPM,
      loopPoint: this.loopPoint,
      metronomeEnabled: this.playbackHandler.metronomeEnabled,
      scrollHorizontalBeats: this.baseView.scrollHorizontalBeats,
      version: 2,
      view: this.baseView,
      cvOutputStates: get(this.cvOutputs).map(cvOutput => cvOutput.serialize()),
    };
  }

  public gate(instanceID: string, lineIx: number) {
    this.uiManager.gateInstance(instanceID, lineIx);
  }

  public ungate(instanceID: string, lineIx: number) {
    this.uiManager.ungateInstance(instanceID, lineIx);
  }

  public getWasmInstance() {
    if (!this.uiInstance) {
      throw new UnreachableException('Tried to get Wasm instance before UI instance initialized');
    } else if (!this.uiInstance.wasm) {
      throw new UnreachableException('Tried to get Wasm instance before it was initialized');
    }
    return this.uiInstance.wasm;
  }

  public getCursorPosBeats(): number {
    return this.playbackHandler.getCursorPosBeats();
  }

  public setBeatSnapInterval(beatSnapInterval: number) {
    this.beatSnapInterval = beatSnapInterval;
  }

  public setScrollHorizontalBeats(scrollHorizontalBeats: number) {
    this.baseView.scrollHorizontalBeats = scrollHorizontalBeats;
    this.uiManager.updateAllViews();
  }

  public addCVOutput() {
    const cvOutputs = get(this.cvOutputs);
    let name = `CV Output ${cvOutputs.length + 1}`;
    while (cvOutputs.some(cvOutput => cvOutput.name === name)) {
      name = `${name}_1`;
    }
    const cvOutput = new CVOutput(
      this,
      this.ctx,
      this.vcId,
      name,
      buildDefaultCVOutputState(this.vcId, name),
      this.silentOutput
    );
    cvOutputs.push(cvOutput);
    this.cvOutputs.set(cvOutputs);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
    return cvOutput;
  }

  public deleteCVOutput(name: string) {
    const cvOutputs = get(this.cvOutputs);
    const ix = cvOutputs.findIndex(cvOutput => cvOutput.name === name);
    if (ix === -1) {
      console.warn(`Tried to delete CV output ${name} but it doesn't exist`);
      return;
    }
    const removed = cvOutputs.splice(ix, 1);
    removed[0].destroy();
    this.cvOutputs.set(cvOutputs);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
  }

  public renameCVOutput(oldName: string, newName: string) {
    const cvOutputs = get(this.cvOutputs);
    const ix = cvOutputs.findIndex(cvOutput => cvOutput.name === oldName);
    if (ix === -1) {
      console.warn(`Tried to rename CV output ${oldName} but it doesn't exist`);
      return;
    }

    if (cvOutputs.some(cvOutput => cvOutput.name === newName)) {
      newName = `${newName}_1`;
    }

    cvOutputs[ix].name = newName;
    this.cvOutputs.set(cvOutputs);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
  }

  public destroy() {
    try {
      this.playbackHandler.destroy();
      this.uiInstance?.destroy();
    } catch (err) {
      console.warn('Error destroying `MIDIEditorInstance`: ', err);
    }
  }
}

const Instances: Map<string, MIDIEditorInstance> = new Map();

const getContainerID = (vcId: string) => `midiEditor_${vcId}`;

export const hide_midi_editor = mkContainerHider(getContainerID);

export const unhide_midi_editor = mkContainerUnhider(getContainerID);

export const init_midi_editor = (vcId: string) => {
  const stateKey = `midiEditor_${vcId}`;
  const initialState: SerializedMIDIEditorState = Option.of(localStorage.getItem(stateKey))
    .flatMap(k => {
      try {
        return Option.of(JSON.parse(k));
      } catch (err) {
        console.warn('Failed to parse stored MIDI editor state; returning default');
        return Option.none();
      }
    })
    .map(normalizeSerializedMIDIEditorState)
    .getOrElseL(buildDefaultMIDIEditorState);
  for (const inst of initialState.instances) {
    while (inst.lines.length < 120) {
      inst.lines.push({ notes: [], midiNumber: inst.lines.length + 21 });
    }
  }

  const inst = new MIDIEditorInstance(new AudioContext(), vcId, initialState);
  Instances.set(vcId, inst);

  const domID = getContainerID(vcId);
  const elem = document.createElement('div');
  elem.id = domID;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  mkContainerRenderHelper({
    Comp: MIDIEditor,
    getProps: () => ({ vcId, initialState, instance: inst }),
    enableReactQuery: true,
  })(domID);
};

export const cleanup_midi_editor = (vcId: string) => {
  const stateKey = `midiEditor_${vcId}`;
  const inst = Instances.get(vcId);
  if (!inst) {
    throw new UnreachableException(
      `Tried to cleanup MIDI editor with vcId=${vcId} that isn't in instance map`
    );
  }

  const serializedState = JSON.stringify(inst.serialize());
  localStorage.setItem(stateKey, serializedState);

  Instances.delete(vcId);
  inst.destroy();

  mkContainerCleanupHelper({})(getContainerID(vcId));
};

export const get_midi_editor_audio_connectables = (vcId: string): AudioConnectables => {
  const inst = Instances.get(vcId);
  if (!inst) {
    throw new UnreachableException(`No MIDI editor instance in map with vcId=${vcId}`);
  }

  const insts = get(inst.uiManager.instances);
  let outputs = insts.reduce(
    (acc, inst) => acc.set(`${inst.name}_out`, { type: 'midi', node: inst.midiOutput }),
    ImmMap<string, ConnectableOutput>()
  );

  outputs = get(inst.cvOutputs).reduce((acc, output) => {
    const awpOut = output.backend.getOutputSync() ?? output.dummyOutput;

    return acc.set(output.name, {
      type: 'number',
      node: awpOut,
    });
  }, outputs);

  const inputs = insts.reduce(
    (acc, inst) => acc.set(`${inst.name}_in`, { type: 'midi', node: inst.midiInput }),
    ImmMap<string, ConnectableInput>()
  );

  return { vcId, inputs, outputs };
};
