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
import MIDIEditor from 'src/midiEditor/MIDIEditor';
import MIDIEditorPlaybackHandler from 'src/midiEditor/PlaybackHandler';

export class MIDIEditorInstance {
  public vcId: string;
  public midiInput: MIDINode;
  public midiOutput: MIDINode;
  private playbackHandler: MIDIEditorPlaybackHandler;
  public uiInstance: MIDIEditorUIInstance | undefined;
  public lineCount: number;
  private midiInputCBs: MIDIInputCbs = {
    onAttack: (note, velocity) => {
      if (!this.playbackHandler.isPlaying) {
        this.midiInput.onAttack(note, velocity);
      }
      // TODO
    },
    onRelease: (note, velocity) => {
      if (!this.playbackHandler.isPlaying) {
        this.midiInput.onRelease(note, velocity);
      }
      // TODO
    },
    onPitchBend: bendAmount => {
      if (!this.playbackHandler.isPlaying) {
        this.midiInput.outputCbs.forEach(cbs => cbs.onPitchBend(bendAmount));
      }
    },
    onClearAll: () => {
      if (!this.playbackHandler.isPlaying) {
        this.midiInput.outputCbs.forEach(cbs => cbs.onClearAll());
      }
      // TODO
    },
  };

  constructor(vcId: string, lineCount: number) {
    this.lineCount = lineCount;
    this.vcId = vcId;
    this.midiInput = new MIDINode(() => this.midiInputCBs);
    this.midiOutput = new MIDINode();
    this.midiOutput.getInputCbs = mkBuildPasthroughInputCBs(this.midiOutput);
    // By default, we pass MIDI events through from the input to the output
    this.midiInput.connect(this.midiOutput);
    this.playbackHandler = new MIDIEditorPlaybackHandler(this);
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

  public gate(lineIx: number) {
    this.midiInputCBs.onAttack(this.lineCount - lineIx, 255);
  }

  public ungate(lineIx: number) {
    this.midiInputCBs.onRelease(this.lineCount - lineIx, 255);
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

const buildDefaultMIDIEditorState = (): SerializedMIDIEditorState => {
  const maxMIDINumber = 90;
  return {
    lines: new Array(maxMIDINumber)
      .fill(null)
      .map((_, lineIx) => ({ notes: [], midiNumber: maxMIDINumber - lineIx })),
    view: { pxPerBeat: 32, scrollVerticalPx: 0, scrollHorizontalBeats: 0, beatsPerMeasure: 4 },
    beatSnapInterval: 1,
    selectedNoteIDs: [],
  };
};

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
    .getOrElseL(buildDefaultMIDIEditorState);
  const inst = new MIDIEditorInstance(vcId, initialState.lines.length);
  Instances.set(vcId, inst);

  const domID = getContainerID(vcId);
  const elem = document.createElement('div');
  elem.id = domID;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

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
