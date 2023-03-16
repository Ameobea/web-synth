import { UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import { get } from 'svelte/store';

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

export class MIDIEditorInstance {
  public vcId: string;
  public baseView: MIDIEditorBaseView;
  public localBPM: number;
  public loopPoint: number | null;
  public beatSnapInterval: number;
  public playbackHandler: MIDIEditorPlaybackHandler;
  public uiManager: MIDIEditorUIManager;

  constructor(ctx: AudioContext, vcId: string, initialState: SerializedMIDIEditorState) {
    this.vcId = vcId;
    this.baseView = initialState.view;
    this.localBPM = initialState.localBPM;
    this.loopPoint = initialState.loopPoint;
    this.beatSnapInterval = initialState.beatSnapInterval;

    this.uiManager = new MIDIEditorUIManager(ctx, this, initialState, vcId);

    this.playbackHandler = new MIDIEditorPlaybackHandler(this, initialState);
  }

  public serialize(): SerializedMIDIEditorState {
    const serializedInstances = this.uiManager.serializeInstances();
    return {
      beatSnapInterval: this.beatSnapInterval,
      cursorPosBeats: this.getCursorPosBeats(),
      instances: serializedInstances,
      localBPM: this.localBPM,
      loopPoint: this.loopPoint,
      metronomeEnabled: this.playbackHandler.metronomeEnabled,
      scrollHorizontalBeats: this.baseView.scrollHorizontalBeats,
      version: 2,
      view: this.baseView,
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

  public addCVOutput() {
    this.uiManager.addCVOutput();
  }

  public deleteCVOutput(name: string) {
    this.uiManager.deleteCVOutput(name);
  }

  public renameCVOutput(oldName: string, newName: string) {
    this.uiManager.renameCVOutput(oldName, newName);
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
      } catch (err) {
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
