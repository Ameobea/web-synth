import { UnreachableException } from 'ameo-utils';
import { Map as ImmMap } from 'immutable';
import { Option } from 'funfix-core';

import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkBuildPasthroughInputCBs, MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import MIDIEditorUIInstance, {
  SerializedMIDIEditorState,
} from 'src/midiEditor/MIDIEditorUIInstance';
import * as conf from './conf';
import MIDIEditor from 'src/midiEditor/MIDIEditor';

interface RecordingPlaybackState {
  type: 'recording';
}

interface LoopingPlaybackState {
  type: 'looping';
}

type PlaybackState = RecordingPlaybackState | LoopingPlaybackState;

export class MIDIEditorInstance {
  public vcId: string;
  public midiInput: MIDINode;
  public midiOutput: MIDINode;
  private playbackState: PlaybackState | null = null;
  private uiInstance: MIDIEditorUIInstance | undefined;
  private midiInputCBs: MIDIInputCbs = {
    onAttack: (note, velocity) => {
      // TODO
    },
    onRelease: (note, velocity) => {
      // TODO
    },
    onPitchBend: () => {
      /* ignore */
    },
    onClearAll: () => {
      // TODO
    },
  };

  constructor(vcId: string) {
    this.vcId = vcId;
    this.midiInput = new MIDINode(() => this.midiInputCBs);
    this.midiOutput = new MIDINode();
    this.midiOutput.getInputCbs = mkBuildPasthroughInputCBs(this.midiOutput);
    // By default, we pass MIDI events through from the input to the output
    this.midiInput.connect(this.midiOutput);
  }

  /**
   * The canvas used to render the UI for the MIDI is created by React and isn't available until after
   * we render the UI, so we set it here via callback so we can route events to and from it.
   */
  public registerUI(uiInstance: MIDIEditorUIInstance) {
    this.uiInstance = uiInstance;
  }

  public serialize(): SerializedMIDIEditorState {
    if (!this.uiInstance) {
      return buildDefaultMIDIEditorState();
    }
    return this.uiInstance.serialize();
  }
}

const Instances: Map<string, MIDIEditorInstance> = new Map();

const getContainerID = (vcId: string) => `midiEditor_${vcId}`;

const buildDefaultMIDIEditorState = (): SerializedMIDIEditorState => ({
  lines: new Array(conf.LINE_COUNT).fill(null).map(() => []),
  view: { pxPerBeat: 32, scrollVerticalPx: 0, scrollHorizontalBeats: 0, beatsPerMeasure: 4 },
  beatSnapInterval: 1,
  selectedNoteIDs: [],
});

export const hide_midi_editor = mkContainerHider(getContainerID);

export const unhide_midi_editor = mkContainerUnhider(getContainerID);

export const init_midi_editor = (vcId: string) => {
  const stateKey = `midiEditor_${vcId}`;
  const inst = new MIDIEditorInstance(vcId);
  Instances.set(vcId, inst);

  const domID = getContainerID(vcId);
  const elem = document.createElement('div');
  elem.id = domID;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const initialState: SerializedMIDIEditorState = Option.of(localStorage.getItem(stateKey))
    .flatMap(k => {
      try {
        return Option.of(JSON.parse(k));
      } catch (err) {
        console.warn('Failed to parse stored MIDI editor state; returning default');
        return Option.none();
      }
    })
    .getOrElseL(buildDefaultMIDIEditorState);
  console.log(initialState);

  mkContainerRenderHelper({
    Comp: MIDIEditor,
    getProps: () => ({
      vcId,
      height: window.innerHeight - 80,
      width: window.innerWidth - 80,
      initialState,
      instance: inst,
    }),
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

  console.log(inst.serialize().lines[0]);
  const serializedState = JSON.stringify(inst.serialize());
  localStorage.setItem(stateKey, serializedState);

  mkContainerCleanupHelper({})(getContainerID(vcId));
};

export const get_midi_editor_audio_connectables = (vcId: string): AudioConnectables => {
  const inst = Instances.get(vcId);
  if (!inst) {
    throw new UnreachableException(`No MIDI editor instance in map with vcId=${vcId}`);
  }

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('midi_in', {
      type: 'midi',
      node: inst.midiInput,
    }),
    outputs: ImmMap<string, ConnectableOutput>().set('midi_out', {
      type: 'midi',
      node: inst.midiOutput,
    }),
  };
};
