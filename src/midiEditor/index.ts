import { UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import { get, writable, type Writable } from 'svelte/store';

import { buildDefaultCVOutputState, CVOutput } from 'src/midiEditor/CVOutput/CVOutput';
import MIDIEditor from 'src/midiEditor/MIDIEditor';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import type { SerializedMIDIEditorState } from 'src/midiEditor/MIDIEditorUIInstance';
import MIDIEditorPlaybackHandler from 'src/midiEditor/PlaybackHandler';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { MIDINode, mkBuildPasthroughInputCBs, type MIDIInputCbs } from 'src/patchNetwork/midiNode';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';

export class MIDIEditorInstance {
  public vcId: string;
  public midiInput: MIDINode;
  public midiOutput: MIDINode;
  public playbackHandler: MIDIEditorPlaybackHandler;
  public uiInstance: MIDIEditorUIInstance | undefined;
  public lineCount: number;
  private ctx: AudioContext;
  private silentOutput: GainNode;

  public cvOutputs: Writable<CVOutput[]>;

  private midiInputCBs: MIDIInputCbs = {
    onAttack: (note, velocity) => {
      // if (!this.playbackHandler.isPlaying || this.playbackHandler.recordingCtx) {
      this.midiInput.onAttack(note, velocity);
      this.uiInstance?.onGated(this.lineCount - note);
      // }

      if (this.playbackHandler?.recordingCtx) {
        this.playbackHandler.recordingCtx.onAttack(note);
      }
    },
    onRelease: (note, velocity) => {
      // if (!this.playbackHandler.isPlaying || this.playbackHandler.recordingCtx) {
      this.midiInput.onRelease(note, velocity);
      this.uiInstance?.onUngated(this.lineCount - note);
      // }

      if (this.playbackHandler?.recordingCtx) {
        this.playbackHandler.recordingCtx.onRelease(note);
      }
    },
    onPitchBend: bendAmount => {
      if (!this.playbackHandler.isPlaying || this.playbackHandler.recordingCtx) {
        this.midiInput.outputCbs.forEach(cbs => cbs.onPitchBend(bendAmount));
      }
    },
    onClearAll: () => {
      if (!this.playbackHandler.isPlaying || this.playbackHandler.recordingCtx) {
        this.midiInput.outputCbs.forEach(cbs => cbs.onClearAll());
      }
      // TODO
    },
  };

  constructor(ctx: AudioContext, vcId: string, initialState: SerializedMIDIEditorState) {
    this.ctx = ctx;
    this.lineCount = initialState.lines.length;
    this.vcId = vcId;
    this.silentOutput = new GainNode(ctx);
    this.silentOutput.gain.value = 0;

    this.playbackHandler = new MIDIEditorPlaybackHandler(this, initialState);
    this.cvOutputs = writable(
      initialState.cvOutputStates?.map(
        state => new CVOutput(this, this.ctx, this.vcId, state.name, state, this.silentOutput)
      ) ?? []
    );

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

const buildDefaultMIDIEditorState = (): SerializedMIDIEditorState => {
  const maxMIDINumber = 120;
  return {
    lines: new Array(maxMIDINumber)
      .fill(null)
      .map((_, lineIx) => ({ notes: [], midiNumber: maxMIDINumber - lineIx })),
    view: { pxPerBeat: 32, scrollVerticalPx: 0, scrollHorizontalBeats: 0, beatsPerMeasure: 4 },
    beatSnapInterval: 1,
    cursorPosBeats: 0,
    localBPM: 120,
    loopPoint: null,
    metronomeEnabled: true,
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
  while (initialState.lines.length < 90) {
    initialState.lines.push({ notes: [], midiNumber: initialState.lines.length + 21 });
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

  let outputs = ImmMap<string, ConnectableOutput>().set('midi_out', {
    type: 'midi',
    node: inst.midiOutput,
  });
  outputs = get(inst.cvOutputs).reduce((acc, output) => {
    const awpOut = output.backend.getOutputSync() ?? output.dummyOutput;

    return acc.set(output.name, {
      type: 'number',
      node: awpOut,
    });
  }, outputs);

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('midi_in', {
      type: 'midi',
      node: inst.midiInput,
    }),
    outputs,
  };
};
