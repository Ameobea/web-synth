import { get, writable, type Writable } from 'svelte/store';

import {
  get_midi_editor_audio_connectables,
  MIDIEditorInstance,
  MIDIEditorInstanceView,
  SerializedMIDIEditorBaseInstance,
  SerializedMIDIEditorInstance,
  SerializedMIDIEditorState,
  SerializedMIDILine,
} from 'src/midiEditor';
import { buildDefaultCVOutputState, CVOutput } from 'src/midiEditor/CVOutput/CVOutput';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import { updateConnectables } from 'src/patchNetwork/interface';
import { MIDINode, mkBuildPasthroughInputCBs, type MIDIInputCbs } from 'src/patchNetwork/midiNode';

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
  // TODO: SVG minimap integration

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
  }

  public get lineCount(): number {
    return this.lines.length;
  }

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

  // TODO: This is a holdover until we implement full multi-instance support.
  public get activeUIInstance(): MIDIEditorUIInstance | undefined {
    const instances = get(this.instances);
    const instance = instances[0];
    if (instance.type !== 'midiEditor') {
      console.error('Active UI instance is not a MIDI editor');
      return undefined;
    }
    if (instance.isExpanded) {
      return instance.instance.uiInst;
    }
    return undefined;
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
      inst.instance.uiInst?.destroy();
      inst.instance.uiInst = undefined;
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

    this.resizeInstances(instances);
    this.instances.set(instances);
  }

  public computeUIInstanceHeight(): number {
    const instances = get(this.instances);
    const activeInstanceCount = instances.filter(
      inst => inst.type === 'midiEditor' && inst.isExpanded
    ).length;
    return Math.max(500, (this.windowSize.height - 140) / activeInstanceCount);
  }

  private resizeInstances(instances: ManagedInstance[]) {
    const height = this.computeUIInstanceHeight();
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      if (!inst.isExpanded) {
        continue;
      }

      if (inst.type === 'midiEditor') {
        inst.instance.uiInst?.setSize(this.windowSize.width - 80, height);
      }
    }
  }

  public addMIDIEditorInstance(defaultActive = true) {
    const instances = get(this.instances);
    let instName = `midi_out_${instances.length}`;
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
    const id = crypto.randomUUID();
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
      inst.instance.uiInst?.destroy();
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
    const id = crypto.randomUUID();
    insts.push({ type: 'cvOutput', id, isExpanded: true, instance: cvOutput });
    this.instances.set(insts);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
    return cvOutput;
  }

  public deleteCVOutput(name: string) {
    const insts = get(this.instances);
    const cvOutput = insts.find(inst => inst.type === 'cvOutput' && inst.instance.name === name);
    if (!cvOutput) {
      console.error(`Could not find CV output with name ${name} to destroy`);
      return;
    }
    const output = cvOutput.instance as CVOutput;

    output.destroy();
    insts.splice(insts.indexOf(cvOutput), 1);
    this.instances.set(insts);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
  }

  public renameCVOutput(oldName: string, newName: string) {
    const insts = get(this.instances);
    const cvOutput = insts.find(inst => inst.type === 'cvOutput' && inst.instance.name === oldName);
    if (!cvOutput) {
      console.error(`Could not find CV output with name ${oldName} to rename`);
      return;
    }
    const output = cvOutput.instance as CVOutput;

    while (insts.some(inst => inst.instance.name === newName)) {
      newName = `${newName}_1`;
    }
    output.name = newName;

    this.instances.set(insts);
    setTimeout(() => updateConnectables(this.vcId, get_midi_editor_audio_connectables(this.vcId)));
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
          crypto.randomUUID(),
          inst.state.lines
        );
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
          id: crypto.randomUUID(),
          isExpanded: inst.state.isExpanded,
          instance,
        };
      } else {
        throw new Error(`Unknown instance type ${(inst as any).type}`);
      }
    });
    this.instances = writable(instances);
  }

  // TODO: This is a holdover until we implement full multi-instance support.
  public setActiveInstance(instance: MIDIEditorUIInstance) {
    this.instances.update(instances => {
      const firstInst = instances[0];
      if (firstInst.type !== 'midiEditor') {
        throw new Error('Expected first instance to be a MIDI editor');
      }
      firstInst.instance.uiInst = instance;
      return instances;
    });
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

  public getSerializedStateForMIDIInstance(id: string): SerializedMIDIEditorInstance {
    const inst = this.getMIDIEditorInstanceByID(id);
    if (!inst) {
      throw new Error(`Could not find UI instance with ID ${id}`);
    }
    const isExpanded = get(this.instances).find(inst => inst.id === id)?.isExpanded ?? false;

    return {
      name: inst.name,
      isExpanded,
      view: inst.view,
      lines: inst.lines,
    };
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
}
