import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import { derived, get, type Readable, type Writable, writable } from 'svelte/store';

import { type SerializedCVOutputState } from 'src/midiEditor/CVOutput/CVOutput';
import MIDIEditor from 'src/midiEditor/MIDIEditor';
import { MIDIEditorUIManager } from 'src/midiEditor/MIDIEditorUIManager';
import MIDIEditorPlaybackHandler from 'src/midiEditor/PlaybackHandler';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import { UnreachableError } from 'src/util';

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
  isExpanded: boolean;
  view: MIDIEditorInstanceView;
}

export type SerializedMIDIEditorBaseInstance =
  | { type: 'midiEditor'; state: SerializedMIDIEditorInstance }
  | { type: 'cvOutput'; state: SerializedCVOutputState };

export interface SerializedMIDIEditorState {
  version: 2;
  scrollHorizontalBeats: number;
  instances: SerializedMIDIEditorBaseInstance[];
  view: MIDIEditorBaseView;
  localBPM: number;
  loopPoint: number | null;
  metronomeEnabled: boolean;
  beatSnapInterval: number;
  cursorPosBeats: number;
}

const buildDefaultMIDIEditorInstanceState = (): SerializedMIDIEditorInstance => {
  const maxMIDINumber = 120;
  return {
    name: 'midi',
    lines: new Array(maxMIDINumber)
      .fill(null)
      .map((_, lineIx) => ({ notes: [], midiNumber: maxMIDINumber - lineIx })),
    isExpanded: true,
    view: { scrollVerticalPx: 0 },
  };
};

const buildDefaultMIDIEditorState = (): SerializedMIDIEditorState => ({
  instances: [{ type: 'midiEditor', state: buildDefaultMIDIEditorInstanceState() }],
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
  const instances: SerializedMIDIEditorBaseInstance[] = [
    {
      type: 'midiEditor',
      state: {
        name: 'midi',
        lines: oldState.lines,
        isExpanded: true,
        view: { scrollVerticalPx: oldState.view.scrollVerticalPx },
      },
    },
  ];
  for (const cvOutputState of oldState.cvOutputStates || []) {
    instances.push({ type: 'cvOutput', state: cvOutputState });
  }
  return {
    instances,
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

class ProxyMIDIEditorBaseView {
  public readonly store: Writable<MIDIEditorBaseView>;
  public readonly pxPerBeatStore: Readable<number>;
  public readonly scrollHorizontalBeatsStore: Readable<number>;
  public readonly inner: MIDIEditorBaseView;

  constructor(inner: MIDIEditorBaseView) {
    this.inner = inner;
    this.store = writable(inner);
    this.pxPerBeatStore = derived(this.store, v => v.pxPerBeat);
    this.scrollHorizontalBeatsStore = derived(this.store, v => v.scrollHorizontalBeats);
  }

  public get pxPerBeat() {
    return this.inner.pxPerBeat;
  }

  public set pxPerBeat(val: number) {
    this.inner.pxPerBeat = val;
    this.store.update(v => ({ ...v, pxPerBeat: val }));
  }

  public get scrollHorizontalBeats() {
    return this.inner.scrollHorizontalBeats;
  }

  public set scrollHorizontalBeats(val: number) {
    this.inner.scrollHorizontalBeats = val;
    this.store.update(v => ({ ...v, scrollHorizontalBeats: val }));
  }

  public get beatsPerMeasure() {
    return this.inner.beatsPerMeasure;
  }

  public set beatsPerMeasure(val: number) {
    this.inner.beatsPerMeasure = val;
    this.store.update(v => ({ ...v, beatsPerMeasure: val }));
  }
}

export class MIDIEditorInstance {
  public vcId: string;
  public baseView: ProxyMIDIEditorBaseView;
  public localBPM: number;
  public beatSnapInterval: number;
  public playbackHandler: MIDIEditorPlaybackHandler;
  public uiManager: MIDIEditorUIManager;

  constructor(ctx: AudioContext, vcId: string, initialState: SerializedMIDIEditorState) {
    this.vcId = vcId;
    this.baseView = new ProxyMIDIEditorBaseView(initialState.view);
    this.localBPM = initialState.localBPM;
    this.beatSnapInterval = initialState.beatSnapInterval;

    this.playbackHandler = new MIDIEditorPlaybackHandler(this, initialState);

    this.uiManager = new MIDIEditorUIManager(ctx, this, initialState, vcId);
  }

  public serialize(): SerializedMIDIEditorState {
    const serializedInstances = this.uiManager.serializeInstances();
    return {
      beatSnapInterval: this.beatSnapInterval,
      cursorPosBeats: this.getCursorPosBeats(),
      instances: serializedInstances,
      localBPM: this.localBPM,
      loopPoint: this.playbackHandler.getLoopPoint(),
      metronomeEnabled: this.playbackHandler.metronomeEnabled,
      scrollHorizontalBeats: this.baseView.scrollHorizontalBeats,
      version: 2,
      view: this.baseView.inner,
    };
  }

  public gate(instanceID: string, lineIx: number) {
    this.uiManager.gateInstance(instanceID, lineIx);
  }

  public ungate(instanceID: string, lineIx: number) {
    this.uiManager.ungateInstance(instanceID, lineIx);
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

  public setPxPerBeat(pxPerBeat: number) {
    this.baseView.pxPerBeat = pxPerBeat;
    this.uiManager.updateAllViews();
  }

  public setLoopEnabled(enabled: boolean) {
    const loopCurrentlyEnabled = this.playbackHandler.getLoopPoint() !== null;
    if (loopCurrentlyEnabled === enabled) {
      return;
    }

    const newLoopPoint = enabled ? this.getCursorPosBeats() + 4 : null;
    this.setLoopPoint(newLoopPoint);
  }

  public setBeatsPerMeasure(beatsPerMeasure: number) {
    this.baseView.beatsPerMeasure = beatsPerMeasure;
    this.uiManager.updateAllViews();
  }

  public snapBeat(rawBeat: number): number {
    if (this.beatSnapInterval === 0) {
      return rawBeat;
    }

    return Math.round(rawBeat * (1 / this.beatSnapInterval)) / (1 / this.beatSnapInterval);
  }

  /**
   * Retruns `true` if the loop point was actually updated and `false` if it wasn't updated due to
   * playback currently being active or something else.
   */
  public setLoopPoint(loopPoint: number | null): boolean {
    const didUpdate = this.playbackHandler.setLoopPoint(loopPoint);
    if (didUpdate) {
      this.uiManager.updateLoopPoint(loopPoint);
    }
    return didUpdate;
  }

  public addCVOutput() {
    this.uiManager.addCVOutput();
  }

  public deleteCVOutput(name: string) {
    this.uiManager.deleteCVOutput(name);
  }

  public renameCVOutput(oldName: string, newName: string) {
    this.uiManager.renameInstance(oldName, newName);
  }

  public destroy() {
    try {
      this.playbackHandler.destroy();
      this.uiManager.destroy();
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
      } catch (_err) {
        console.warn('Failed to parse stored MIDI editor state; returning default');
        return Option.none();
      }
    })
    .map(normalizeSerializedMIDIEditorState)
    .getOrElseL(buildDefaultMIDIEditorState);
  for (const inst of initialState.instances) {
    if (inst.type === 'midiEditor') {
      while (inst.state.lines.length < 120) {
        inst.state.lines.push({ notes: [], midiNumber: inst.state.lines.length + 21 });
      }
    }
  }

  const inst = new MIDIEditorInstance(new AudioContext(), vcId, initialState);
  Instances.set(vcId, inst);

  const domID = getContainerID(vcId);
  const elem = document.createElement('div');
  elem.id = domID;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none; overflow-x: hidden;'
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
    throw new UnreachableError(
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
    throw new UnreachableError(`No MIDI editor instance in map with vcId=${vcId}`);
  }

  const insts = get(inst.uiManager.instances);
  const outputs = insts.reduce((acc, inst) => {
    if (inst.type === 'midiEditor') {
      return acc.set(`${inst.instance.name}_out`, { type: 'midi', node: inst.instance.midiOutput });
    } else if (inst.type === 'cvOutput') {
      const output = inst.instance;
      const awpOut = output.backend.getOutputSync() ?? output.dummyOutput;
      return acc.set(inst.instance.name, { type: 'number', node: awpOut });
    } else {
      console.error('Unknown instance type: ', inst);
      return acc;
    }
  }, ImmMap<string, ConnectableOutput>());

  const inputs = insts.reduce((acc, inst) => {
    if (inst.type === 'midiEditor') {
      return acc.set(`${inst.instance.name}_in`, { type: 'midi', node: inst.instance.midiInput });
    } else {
      return acc;
    }
  }, ImmMap<string, ConnectableInput>());

  return { vcId, inputs, outputs };
};
