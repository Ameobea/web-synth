import * as R from 'ramda';
import { get, writable, type Writable } from 'svelte/store';

import {
  get_midi_editor_audio_connectables,
  type MIDIEditorInstance,
  type MIDIEditorInstanceView,
  type SerializedMIDIEditorBaseInstance,
  type SerializedMIDIEditorInstance,
  type SerializedMIDIEditorState,
  type SerializedMIDILine,
} from 'src/midiEditor';
import { buildDefaultCVOutputState, CVOutput } from 'src/midiEditor/CVOutput/CVOutput';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import type { Note } from 'src/midiEditor/MIDIEditorUIInstance';
import { renderMIDIMinimap } from 'src/midiEditor/Minimap/MinimapRenderer';
import { connect, updateConnectables } from 'src/patchNetwork/interface';
import { MIDINode, mkBuildPasthroughInputCBs, type MIDIInputCbs } from 'src/patchNetwork/midiNode';
import { AsyncOnce } from 'src/util';
import { getState } from 'src/redux';

const NoteContainerWasm = new AsyncOnce(() => import('src/note_container'), true);

export class ManagedMIDIEditorUIInstance {
  public manager: MIDIEditorUIManager;
  public id: string;
  public name: string;
  public view: MIDIEditorInstanceView;
  public uiInst: MIDIEditorUIInstance | undefined;
  public midiInput: MIDINode;
  public midiOutput: MIDINode;
  public midiInputCBs: MIDIInputCbs;
  public lines: SerializedMIDILine[];
  private onWasmInitCBs: ((linesWithIDs: readonly Note[][]) => void)[] = [];
  public wasm:
    | {
        instance: typeof import('src/note_container');
        noteLinesCtxPtr: number;
        linesWithIDs: readonly Note[][];
      }
    | undefined;
  public renderedMinimap: SVGSVGElement | undefined;

  constructor(
    manager: MIDIEditorUIManager,
    name: string,
    view: MIDIEditorInstanceView,
    id: string,
    lines: SerializedMIDILine[]
  ) {
    this.manager = manager;
    this.id = id;
    this.name = name;
    this.view = view;
    this.lines = lines;
    this.midiInputCBs = this.buildInstanceMIDIInputCbs();

    this.midiInput = new MIDINode(() => this.midiInputCBs);
    this.midiOutput = new MIDINode();
    this.midiOutput.getInputCbs = mkBuildPasthroughInputCBs(this.midiOutput);
    // By default, we pass MIDI events through from the input to the output
    this.midiInput.connect(this.midiOutput);

    this.initWasm(lines);
  }

  public async initWasm(lines: SerializedMIDILine[]) {
    const wasm = await NoteContainerWasm.get();

    const noteLinesCtxPtr = wasm.create_note_lines(lines.length);

    const linesWithIDs: Note[][] = new Array(lines.length).fill(null).map(() => []);
    for (const { midiNumber, notes } of lines) {
      const lineIx = lines.length - midiNumber;
      for (const { length, startPoint } of notes) {
        const id = wasm.create_note(noteLinesCtxPtr, lineIx, startPoint, length, 0);
        linesWithIDs[lineIx].push({ id, startPoint, length });
      }
    }

    if (this.wasm) {
      this.wasm.instance.free_note_lines(this.wasm.noteLinesCtxPtr);
    }

    this.wasm = {
      instance: wasm,
      noteLinesCtxPtr,
      linesWithIDs,
    };

    this.onWasmInitCBs.forEach(cb => cb(linesWithIDs));
    this.onWasmInitCBs = [];
  }

  public get lineCount(): number {
    return this.lines.length;
  }

  public onWasmLoaded = (cb: (linesWithIDs: readonly Note[][]) => void) => {
    if (this.wasm) {
      cb(this.wasm.linesWithIDs);
    } else {
      this.onWasmInitCBs.push(cb);
    }
  };

  private buildInstanceMIDIInputCbs = (): MIDIInputCbs => ({
    onAttack: (note, velocity) => {
      // if (!this.playbackHandler.isPlaying || this.playbackHandler.recordingCtx) {
      this.midiInput.onAttack(note, velocity);
      this.uiInst?.onGated(this.lineCount - note);
      // }

      if (this.manager.parentInst.playbackHandler.recordingCtx) {
        this.manager.parentInst.playbackHandler.recordingCtx.onAttack(note);
      }
    },
    onRelease: (note, velocity) => {
      // if (!this.playbackHandler.isPlaying || this.playbackHandler.recordingCtx) {
      this.midiInput.onRelease(note, velocity);
      this.uiInst?.onUngated(this.lineCount - note);
      // }

      if (this.manager.parentInst.playbackHandler.recordingCtx) {
        this.manager.parentInst.playbackHandler.recordingCtx.onRelease(note);
      }
    },
    onPitchBend: bendAmount => {
      if (
        !this.manager.parentInst.playbackHandler.isPlaying ||
        this.manager.parentInst.playbackHandler.recordingCtx
      ) {
        this.midiInput.outputCbs.forEach(cbs => cbs.onPitchBend(bendAmount));
      }
    },
    onClearAll: () => {
      if (
        !this.manager.parentInst.playbackHandler.isPlaying ||
        this.manager.parentInst.playbackHandler.recordingCtx
      ) {
        this.midiInput.outputCbs.forEach(cbs => cbs.onClearAll());
      }
      // TODO
    },
  });

  public iterNotesWithCB = (
    startBeatInclusive: number | null | undefined,
    endBeatExclusive: number | null | undefined,
    cb: (isAttack: boolean, lineIx: number, rawBeat: number, noteID: number) => void
  ) => {
    if (!this.wasm) {
      throw new Error('Wasm instance not initialized; cannot get Wasm instance');
    }
    const { instance, noteLinesCtxPtr } = this.wasm;

    instance.iter_notes_with_cb(
      noteLinesCtxPtr,
      startBeatInclusive ?? 0,
      endBeatExclusive ?? -1,
      cb,
      true
    );
  };

  public gate(lineIx: number) {
    this.midiInputCBs.onAttack(this.lineCount - lineIx, 255);
  }

  public ungate(lineIx: number) {
    this.midiInputCBs.onRelease(this.lineCount - lineIx, 255);
  }

  public stopPlayback() {
    this.midiOutput.clearAll();
  }

  public serialize(isExpanded: boolean): SerializedMIDIEditorInstance {
    return {
      isExpanded,
      lines: this.uiInst?.serializeLines() ?? this.lines,
      name: this.name,
      view: this.view,
    };
  }

  public destroy() {
    this.uiInst?.destroy();
    this.wasm?.instance.free_note_lines(this.wasm.noteLinesCtxPtr);
  }
}

type BaseManagedInstance =
  | { type: 'midiEditor'; instance: ManagedMIDIEditorUIInstance }
  | { type: 'cvOutput'; instance: CVOutput };

export type ManagedInstance = BaseManagedInstance & {
  id: string;
  isExpanded: boolean;
};

export class MIDIEditorUIManager {
  public parentInst: MIDIEditorInstance;
  public instances: Writable<ManagedInstance[]>;
  private windowSize: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  public scrollHorizontalPx: Writable<number>;
  private silentOutput: GainNode;
  private ctx: AudioContext;
  private vcId: string;
  public activeUIInstance: MIDIEditorUIInstance | undefined;

  public setActiveUIInstanceID(id: string) {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return;
    }
    if (inst.type !== 'midiEditor') {
      console.error(`Instance with ID ${id} is not a MIDI editor`);
      return;
    }

    this.activeUIInstance = inst.instance.uiInst;
  }

  public getMIDIEditorInstanceByID(id: string): ManagedMIDIEditorUIInstance | undefined {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return undefined;
    }
    if (inst.type !== 'midiEditor') {
      console.error(`Instance with ID ${id} is not a MIDI editor`);
      return undefined;
    }

    return inst.instance;
  }

  public getUIInstanceByID(id: string): MIDIEditorUIInstance | undefined {
    return this.getMIDIEditorInstanceByID(id)?.uiInst;
  }

  public setUIInstanceForID(id: string, instance: MIDIEditorUIInstance) {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return;
    }
    if (inst.type !== 'midiEditor') {
      console.error(`Instance with ID ${id} is not a MIDI editor`);
      return;
    }

    inst.instance.uiInst = instance;
    this.instances.set(instances);
  }

  private setMinimapForID(id: string, svg: SVGSVGElement) {
    const insts = get(this.instances);
    const inst = insts.find(inst => inst.id === id);
    // make sure it hasn't been toggled back to expanded in the meantime
    if (!inst || inst.isExpanded || inst.type !== 'midiEditor') {
      return;
    }

    inst.instance.renderedMinimap = svg;
    this.instances.set(insts);
  }

  public collapseUIInstance(id: string) {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return;
    }
    if (!inst.isExpanded) {
      console.error(`Instance with ID ${id} is not active`);
      return;
    }

    if (inst.type === 'midiEditor' && inst.instance.uiInst) {
      inst.instance.lines = inst.instance.uiInst.serializeLines();
      const renderMinimapPromise = renderMIDIMinimap(
        inst.instance.lines,
        this.parentInst.baseView.beatsPerMeasure
      );

      if (this.activeUIInstance === inst.instance.uiInst) {
        this.activeUIInstance = undefined;
      }

      inst.instance.uiInst?.destroy();
      inst.instance.uiInst = undefined;

      renderMinimapPromise.then(svg => this.setMinimapForID(id, svg));
    }
    inst.isExpanded = false;

    this.resizeInstances(instances);
    this.instances.set(instances);
  }

  public expandUIInstance(id: string) {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return;
    }
    if (inst.isExpanded) {
      console.error(`Instance with ID ${id} is already active`);
      return;
    }

    inst.isExpanded = true;
    if (inst.type === 'midiEditor') {
      inst.instance.initWasm(inst.instance.lines);
      inst.instance.renderedMinimap = undefined;
    }

    this.resizeInstances(instances);
    this.instances.set(instances);
  }

  public computeUIInstanceHeight(): number {
    const instances = get(this.instances);
    const cvOutputCount = instances.filter(inst => inst.type === 'cvOutput').length;
    const midiEditorCount = instances.filter(inst => inst.type === 'midiEditor').length;
    if (midiEditorCount === 1 && cvOutputCount <= 2) {
      return this.windowSize.height - 100 * cvOutputCount - 140;
    }
    const activeInstanceCount =
      instances.filter(inst => inst.type === 'midiEditor' && inst.isExpanded).length || 1;

    const maxHeight = Math.max(500, this.windowSize.height - 700);
    return R.clamp(500, maxHeight, (this.windowSize.height - 200) / activeInstanceCount);
  }

  private resizeInstances(instances: ManagedInstance[]) {
    const height = this.computeUIInstanceHeight();
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      if (!inst.isExpanded) {
        continue;
      }

      if (inst.type === 'midiEditor') {
        inst.instance.uiInst?.setSize(this.windowSize.width, height);
      }
    }
  }

  public addMIDIEditorInstance(defaultActive = true) {
    const instances = get(this.instances);
    let instName = 'midi';
    while (
      instances.find(
        inst =>
          (inst.type === 'midiEditor' && inst.instance.name === instName) ||
          (inst.type === 'cvOutput' && inst.instance.name === instName)
      )
    ) {
      instName += '_1';
    }

    const maxMIDINumber = 120;
    const lines: SerializedMIDILine[] = new Array(maxMIDINumber)
      .fill(null)
      .map((_, lineIx) => ({ notes: [], midiNumber: maxMIDINumber - lineIx }));
    const id = genRandomStringID();
    const instance = new ManagedMIDIEditorUIInstance(
      this,
      instName,
      { scrollVerticalPx: 0 },
      id,
      lines
    );
    instances.push({ type: 'midiEditor', id, isExpanded: defaultActive, instance });
    this.resizeInstances(instances);
    this.instances.set(instances);
  }

  public removeInstanceByID(id: string) {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return;
    }

    if (inst.type === 'midiEditor') {
      if (inst.instance.uiInst) {
        if (this.activeUIInstance === inst.instance.uiInst) {
          this.activeUIInstance = undefined;
        }
        inst.instance.uiInst.destroy();
      }
    } else if (inst.type === 'cvOutput') {
      inst.instance.destroy();
    }
    instances.splice(instances.indexOf(inst), 1);
    this.resizeInstances(instances);
    this.instances.set(instances);
  }

  public addCVOutput() {
    const insts = get(this.instances);
    const cvOutputCount = insts.filter(inst => inst.type === 'cvOutput').length;
    let name = `CV Output ${cvOutputCount + 1}`;
    while (insts.some(inst => inst.instance.name === name)) {
      name = `${name}_1`;
    }
    const cvOutput = new CVOutput(
      this.parentInst,
      this.ctx,
      this.vcId,
      name,
      buildDefaultCVOutputState(this.vcId, name),
      this.silentOutput
    );
    const id = genRandomStringID();
    insts.push({ type: 'cvOutput', id, isExpanded: true, instance: cvOutput });
    this.instances.set(insts);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
    return cvOutput;
  }

  public deleteCVOutput(name: string) {
    const insts = get(this.instances);
    const cvOutput = insts.find(inst => inst.type === 'cvOutput' && inst.instance.name === name);
    if (!cvOutput || cvOutput.type !== 'cvOutput') {
      console.error(`Could not find CV output with name ${name} to destroy`);
      return;
    }
    const output = cvOutput.instance;
    const reallyDelete = confirm(`Are you sure you want to delete the CV output "${output.name}"?`);
    if (!reallyDelete) {
      return;
    }

    output.destroy();
    insts.splice(insts.indexOf(cvOutput), 1);
    this.instances.set(insts);
    this.resizeInstances(insts);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
  }

  public deleteMIDIEditorInstance(id: string) {
    const insts = get(this.instances);
    const inst = insts.find(inst => inst.id === id);
    if (!inst || inst.type !== 'midiEditor') {
      console.error(`Could not find MIDI editor instance with ID ${id} to destroy`);
      return;
    }
    const midiEditor = inst.instance;
    const reallyDelete = confirm(
      `Are you sure you want to delete the MIDI editor instance "${midiEditor.name}"?`
    );
    if (!reallyDelete) {
      return;
    }

    midiEditor.destroy();
    insts.splice(insts.indexOf(inst), 1);
    this.instances.set(insts);
    this.resizeInstances(insts);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
  }

  public renameInstance(oldName: string, newName: string) {
    const insts = get(this.instances);
    const inst = insts.find(inst => inst.instance.name === oldName);
    if (!inst) {
      console.error(`Could not find CV output with name ${oldName} to rename`);
      return;
    }
    const output = inst.instance;

    while (insts.some(inst => inst.instance.name === newName)) {
      newName = `${newName}_1`;
    }
    output.name = newName;

    this.instances.set(insts);

    const connections = getState().viewContextManager.patchNetwork.connections;
    const oldInputName = `${oldName}_in`;
    const oldOutputName = `${oldName}_out`;
    const connectedInputs = connections.filter(
      ([_from, to]) => to.vcId === this.vcId && to.name === oldInputName
    );
    const connectedOutputs = connections.filter(
      ([from]) => from.vcId === this.vcId && from.name === oldOutputName
    );
    setTimeout(() => {
      updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId));

      for (const [from, to] of connectedInputs) {
        connect(from, { ...to, name: `${newName}_in` });
      }
      for (const [from, to] of connectedOutputs) {
        connect({ ...from, name: `${newName}_out` }, to);
      }
    });
  }

  public gateInstance(instanceID: string, lineIx: number) {
    const inst = this.getMIDIEditorInstanceByID(instanceID);
    if (!inst) {
      return;
    }

    inst.gate(lineIx);
  }

  public ungateInstance(instanceID: string, lineIx: number) {
    const inst = this.getMIDIEditorInstanceByID(instanceID);
    if (!inst) {
      return;
    }

    inst.ungate(lineIx);
  }

  public updateLoopPoint(loopPoint: number | null) {
    const insts = get(this.instances);
    for (const inst of insts) {
      if (inst.type === 'midiEditor') {
        inst.instance.uiInst?.setLoopPoint(loopPoint);
      }
    }
  }

  constructor(
    ctx: AudioContext,
    parentInst: MIDIEditorInstance,
    initialState: SerializedMIDIEditorState,
    vcId: string
  ) {
    this.parentInst = parentInst;
    this.scrollHorizontalPx = writable(initialState.view.scrollHorizontalBeats);
    this.ctx = ctx;
    this.vcId = vcId;
    this.silentOutput = new GainNode(ctx);
    this.silentOutput.gain.value = 0;

    const instances = initialState.instances.map(inst => {
      if (inst.type === 'midiEditor') {
        const instance = new ManagedMIDIEditorUIInstance(
          this,
          inst.state.name,
          inst.state.view,
          genRandomStringID(),
          inst.state.lines
        );

        if (!inst.state.isExpanded) {
          renderMIDIMinimap(inst.state.lines, this.parentInst.baseView.beatsPerMeasure).then(svg =>
            this.setMinimapForID(instance.id, svg)
          );
        }

        return {
          type: 'midiEditor' as const,
          id: instance.id,
          isExpanded: inst.state.isExpanded,
          instance,
        };
      } else if (inst.type === 'cvOutput') {
        const instance = new CVOutput(
          parentInst,
          ctx,
          vcId,
          inst.state.name,
          inst.state,
          this.silentOutput
        );
        return {
          type: 'cvOutput' as const,
          id: genRandomStringID(),
          isExpanded: inst.state.isExpanded,
          instance,
        };
      } else {
        throw new Error(`Unknown instance type ${(inst as any).type}`);
      }
    });
    this.instances = writable(instances);
  }

  public updateAllViews() {
    const insts = get(this.instances);
    for (const inst of insts) {
      if (inst.type === 'midiEditor' && inst.isExpanded) {
        inst.instance.uiInst?.handleViewChange();
      } else if (inst.type === 'cvOutput') {
        inst.instance.handleViewChange(this.parentInst.baseView);
      }
    }
  }

  public stopAllPlayback() {
    const insts = get(this.instances);
    for (const inst of insts) {
      if (inst.type === 'midiEditor') {
        inst.instance.stopPlayback();
      }
    }
  }

  public serializeInstances(): SerializedMIDIEditorBaseInstance[] {
    const insts = get(this.instances);
    return insts.map(inst => {
      if (inst.type === 'midiEditor') {
        return { type: 'midiEditor', state: inst.instance.serialize(inst.isExpanded) };
      } else if (inst.type === 'cvOutput') {
        return { type: 'cvOutput', state: inst.instance.serialize() };
      } else {
        throw new Error(`Unknown instance type: ${(inst as any).type}`);
      }
    });
  }

  public handleWindowResize = (newWidth: number, newHeight: number) => {
    this.windowSize = { width: newWidth, height: newHeight };
    this.resizeInstances(get(this.instances));
  };

  public destroy() {
    const insts = get(this.instances);
    for (const inst of insts) {
      if (inst.type === 'midiEditor') {
        inst.instance.destroy();
      } else if (inst.type === 'cvOutput') {
        inst.instance.destroy();
      }
    }
    this.instances.set([]);
  }
}
