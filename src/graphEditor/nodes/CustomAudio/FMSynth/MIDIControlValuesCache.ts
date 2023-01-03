import type FMSynth from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { MIDINode, type MIDIInputCbs } from 'src/patchNetwork/midiNode';

export default class MIDIControlValuesCache {
  private lastSeenValues: Map<number, number> = new Map();
  private callbacksByIndex: Map<number, ((controlValue: number) => void)[]> = new Map();

  constructor(initialState: { [controlIndex: number]: number }, srcNode: MIDINode, synth: FMSynth) {
    Object.entries(initialState).forEach(([rawControlIndex, controlValue]) => {
      const controlIndex = +rawControlIndex;
      if (Number.isNaN(controlIndex)) {
        console.error(
          'Invalid control index on `initialState` for `MIDIControlValuesCache` contructor, key was: ',
          rawControlIndex
        );
        return;
      }

      synth.setMIDIControlValue(controlIndex, controlValue);
      this.lastSeenValues.set(controlIndex, controlValue);
    });

    const cbs: MIDIInputCbs = {
      onAttack: () => {
        // ignore
      },
      onRelease: () => {
        // ignore
      },
      onPitchBend: () => {
        // ignore
      },
      onClearAll: () => {
        // ignore
      },
      onGenericControl: (controlIndex, controlValue) => {
        synth.setMIDIControlValue(controlIndex, controlValue);
        this.lastSeenValues.set(controlIndex, controlValue);
        this.callbacksByIndex.get(controlIndex)?.forEach(cb => cb(controlValue));
      },
    };
    const rxNode = new MIDINode(() => cbs);
    srcNode.connect(rxNode);
  }

  public get(controlIndex: number | 'LEARNING' | null): number {
    if (typeof controlIndex === 'number') {
      const cachedValue = this.lastSeenValues.get(controlIndex);
      return cachedValue ?? 0;
    }
    return 0;
  }

  public registerCallback(controlIndex: number, callback: (newValue: number) => void) {
    const callbacks = [...(this.callbacksByIndex.get(controlIndex) ?? []), callback];
    this.callbacksByIndex.set(controlIndex, callbacks);
  }

  public unregisterCallback(controlIndex: number, callback: (newValue: number) => void) {
    const callbacks = this.callbacksByIndex.get(controlIndex);
    if (!callbacks) {
      console.error(
        `Tried to deregister callback for control index ${controlIndex}, but no callback was ever registered for that index`
      );
      return;
    }
    const newCallbacks = callbacks.filter(cb => cb !== callback);
    if (newCallbacks.length === callbacks.length) {
      console.warn(
        'No matching callback found when deregistering callback for control index ' + controlIndex
      );
    }
    this.callbacksByIndex.set(controlIndex, newCallbacks);
  }

  public serialize(): { [controlIndx: number]: number } {
    const out: { [controlIndex: number]: number } = {};
    for (const [controlIndex, controlValue] of this.lastSeenValues.entries()) {
      out[controlIndex] = controlValue;
    }
    return out;
  }
}
