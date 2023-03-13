import { get, writable, type Writable } from 'svelte/store';

import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';

export interface ManagedMIDIEditorUIInstance {
  id: string;
  isActive: boolean;
  instance: MIDIEditorUIInstance | undefined;
  // TODO: SVG minimap integration
}

export class MIDIEditorUIManager {
  public instances: Writable<ManagedMIDIEditorUIInstance[]>;
  private windowSize: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  // TODO: This is a holdover until we implement full multi-instance support.
  public get activeUIInstance(): MIDIEditorUIInstance | undefined {
    const instances = get(this.instances);
    const instance = instances[0];
    if (instance.isActive) {
      return instance.instance;
    }
    return undefined;
  }

  public getUIInstanceByID(id: string): MIDIEditorUIInstance | undefined {
    const instances = get(this.instances);
    const inst = instances.find(inst => inst.id === id);
    if (!inst) {
      console.error(`Could not find UI instance with ID ${id}`);
      return undefined;
    }
    return inst.instance;
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

  constructor() {
    // TODO: Deserialize

    const instances = [
      { id: crypto.randomUUID(), isActive: true, instance: undefined },
      { id: crypto.randomUUID(), isActive: false, instance: undefined },
      { id: crypto.randomUUID(), isActive: false, instance: undefined },
    ];
    this.instances = writable(instances);
  }

  // TODO: This is a holdover until we implement full multi-instance support.
  public setActiveInstance(instance: MIDIEditorUIInstance) {
    this.instances.update(instances => {
      instances[0].instance = instance;
      return instances;
    });
  }

  public handleWindowResize = (newWidth: number, newHeight: number) => {
    this.windowSize = { width: newWidth, height: newHeight };
    this.resizeInstances(get(this.instances));
  };
}
