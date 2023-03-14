import { get, writable, type Writable } from 'svelte/store';

import type {
  MIDIEditorInstance,
  MIDIEditorInstanceView,
  SerializedMIDIEditorInstance,
  SerializedMIDIEditorState,
  SerializedMIDILine,
} from 'src/midiEditor';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import { MIDINode, mkBuildPasthroughInputCBs, type MIDIInputCbs } from 'src/patchNetwork/midiNode';

export class ManagedMIDIEditorUIInstance {
  public manager: MIDIEditorUIManager;
  public id: string;
  public name: string;
  public isActive: boolean;
  public view: MIDIEditorInstanceView;
  public instance: MIDIEditorUIInstance | undefined;
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
    lines: SerializedMIDILine[],
    isActive: boolean
  ) {
    this.manager = manager;
    this.id = id;
    this.name = name;
    this.view = view;
    this.isActive = isActive;
    this.lines = lines;
    this.midiInput = new MIDINode();
    this.midiOutput = new MIDINode();
    this.midiOutput.getInputCbs = mkBuildPasthroughInputCBs(this.midiOutput);
    this.midiInputCBs = this.buildInstanceMIDIInputCbs();
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
      this.instance?.onGated(this.lineCount - note);
      // }

      if (this.manager.parentInst.playbackHandler.recordingCtx) {
        this.manager.parentInst.playbackHandler.recordingCtx.onAttack(note);
      }
    },
    onRelease: (note, velocity) => {
      // if (!this.playbackHandler.isPlaying || this.playbackHandler.recordingCtx) {
      this.midiInput.onRelease(note, velocity);
      this.instance?.onUngated(this.lineCount - note);
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

  public serialize(): SerializedMIDIEditorInstance {
    return {
      isActive: this.isActive,
      lines: this.lines,
      name: this.name,
      view: this.view,
    };
  }
}

export class MIDIEditorUIManager {
  public parentInst: MIDIEditorInstance;
  public instances: Writable<ManagedMIDIEditorUIInstance[]>;
  private windowSize: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  public scrollHorizontalPx: Writable<number>;

  // TODO: This is a holdover until we implement full multi-instance support.
  public get activeUIInstance(): MIDIEditorUIInstance | undefined {
    const instances = get(this.instances);
    const instance = instances[0];
    if (instance.isActive) {
      return instance.instance;
    }
    return undefined;
  }

  public getInstanceByID(id: string): ManagedMIDIEditorUIInstance | undefined {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return undefined;
    }
  }

  public getUIInstanceByID(id: string): MIDIEditorUIInstance | undefined {
    return this.getInstanceByID(id)?.instance;
  }

  public setUIInstanceForID(id: string, instance: MIDIEditorUIInstance) {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return;
    }
    inst.instance = instance;
    this.instances.set(instances);
  }

  public collapseUIInstance(id: string) {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return;
    }
    if (!inst.isActive) {
      console.error(`Instance with ID ${id} is not active`);
      return;
    }

    inst.isActive = false;
    inst.instance?.destroy();
    inst.instance = undefined;

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
    if (inst.isActive) {
      console.error(`Instance with ID ${id} is already active`);
      return;
    }

    inst.isActive = true;

    this.resizeInstances(instances);
    this.instances.set(instances);
  }

  public computeUIInstanceHeight(): number {
    const instances = get(this.instances);
    const activeInstanceCount = instances.filter(inst => inst.isActive).length;
    return Math.max(400, (this.windowSize.height - 140) / activeInstanceCount);
  }

  private resizeInstances(instances: ManagedMIDIEditorUIInstance[]) {
    const height = this.computeUIInstanceHeight();
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      if (!inst.isActive) {
        continue;
      }
      inst.instance?.setSize(this.windowSize.width - 80, height);
    }
  }

  public addInstance(defaultActive = true) {
    const instances = get(this.instances);
    let instName = `midi_out_${instances.length}`;
    while (instances.find(inst => inst.name === instName)) {
      instName += '_1';
    }

    const maxMIDINumber = 120;
    const lines: SerializedMIDILine[] = new Array(maxMIDINumber)
      .fill(null)
      .map((_, lineIx) => ({ notes: [], midiNumber: maxMIDINumber - lineIx }));
    instances.push(
      new ManagedMIDIEditorUIInstance(
        this,
        instName,
        { scrollVerticalPx: 0 },
        crypto.randomUUID(),
        lines,
        defaultActive
      )
    );
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

    inst.instance?.destroy();
    instances.splice(instances.indexOf(inst), 1);
    this.resizeInstances(instances);
    this.instances.set(instances);
  }

  public gateInstance(instanceID: string, lineIx: number) {
    const inst = this.getInstanceByID(instanceID);
    if (!inst) {
      return;
    }

    inst.gate(lineIx);
  }

  public ungateInstance(instanceID: string, lineIx: number) {
    const inst = this.getInstanceByID(instanceID);
    if (!inst) {
      return;
    }

    inst.ungate(lineIx);
  }

  constructor(parentInst: MIDIEditorInstance, initialState: SerializedMIDIEditorState) {
    this.parentInst = parentInst;
    this.scrollHorizontalPx = writable(initialState.view.scrollHorizontalBeats);

    const instances = initialState.instances.map(
      inst =>
        new ManagedMIDIEditorUIInstance(
          this,
          inst.name,
          inst.view,
          crypto.randomUUID(),
          inst.lines,
          inst.isActive
        )
    );
    this.instances = writable(instances);
  }

  // TODO: This is a holdover until we implement full multi-instance support.
  public setActiveInstance(instance: MIDIEditorUIInstance) {
    this.instances.update(instances => {
      instances[0].instance = instance;
      return instances;
    });
  }

  public updateAllViews() {
    const insts = get(this.instances);
    for (const inst of insts) {
      if (inst.isActive) {
        inst.instance?.handleViewChange();
      } else {
        // TODO
      }
    }
  }

  public stopAllPlayback() {
    const insts = get(this.instances);
    for (const inst of insts) {
      inst.stopPlayback();
    }
  }

  public getSerializedStateForInstance(id: string): SerializedMIDIEditorInstance {
    const inst = this.getInstanceByID(id);
    if (!inst) {
      throw new Error(`Could not find UI instance with ID ${id}`);
    }
    return {
      name: inst.name,
      isActive: inst.isActive,
      view: inst.view,
      lines: inst.lines,
    };
  }

  public handleWindowResize = (newWidth: number, newHeight: number) => {
    this.windowSize = { width: newWidth, height: newHeight };
    this.resizeInstances(get(this.instances));
  };
}
