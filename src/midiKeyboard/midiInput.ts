import { Option } from 'funfix-core';
import * as R from 'ramda';

import type { MIDINode } from 'src/patchNetwork/midiNode';
import { UnreachableError, type IterableValueOf } from 'src/util';

export type BuiltinMIDIInput = IterableValueOf<MIDIAccess['inputs']>;

/**
 * Processes MIDI events from some hardware MIDI device
 */
export class MIDIInput {
  public nodeType = 'customAudio/MIDIInput';
  static typeName = 'MIDI Input';

  private selectedInputName: string | undefined;
  private wasmMidiCtxPtr: number | undefined;
  private midiModule: typeof import('src/midi') | undefined;
  private midiAccess: MIDIAccess | undefined;
  private midiInput: BuiltinMIDIInput | undefined;
  private midiMsgHandlerCb: ((evt: Event & { data: Uint8Array }) => void) | undefined;
  public pitchBendNode: ConstantSourceNode;
  public modWheelNode: ConstantSourceNode;
  private onInitCbs: (() => void)[] = [];
  private midiNode: MIDINode | undefined;

  private async initMIDI() {
    let access: MIDIAccess;
    let midiModule: typeof import('src/midi');
    try {
      // Request MIDI access and load the Wasm MIDI module at the same time
      [access, midiModule] = await Promise.all([
        navigator.requestMIDIAccess(),
        this.midiModule || import('src/midi'),
      ] as [Promise<typeof access>, Promise<typeof midiModule>]);
    } catch (err) {
      console.error(`Error while attempting to initialize MIDI input node: ${err}`);
      return;
    }

    this.midiAccess = access;
    this.onInitCbs.forEach(cb => cb());
    this.onInitCbs = [];
    if ((access.inputs as any).size === 0) {
      // No available MIDI inputs
      return;
    }

    this.midiModule = midiModule;

    const input = Option.of(this.selectedInputName)
      .flatMap(inputName => {
        for (const [, input] of access.inputs) {
          if (input.name === inputName) {
            return Option.of(input);
          }
        }

        return Option.none();
      })
      .getOrElseL(() => {
        // If no input was pre-selected, pick an arbitrary one
        for (const [, input] of access.inputs) {
          return input;
        }

        throw new UnreachableError();
      });

    // Register input handlers for the MIDI input so that MIDI events trigger our output callbacks
    // to be called appropriately.
    const ctxPtr = midiModule.create_msg_handler_context(
      (_voiceIx: number, note: number, velocity: number) => this.midiNode?.onAttack(note, velocity),
      (_voiceIx: number, note: number, velocity: number) =>
        this.midiNode?.onRelease(note, velocity),
      (_lsb: number, msb: number) => {
        this.pitchBendNode.offset.value = msb;
        this.midiNode?.outputCbs.forEach(({ onPitchBend }) => onPitchBend(msb));
      },
      (modWheelValue: number) => {
        this.modWheelNode.offset.value = modWheelValue;
      },
      (controlIndex: number, controlValue: number) =>
        this.midiNode?.outputCbs.forEach(({ onGenericControl }) =>
          onGenericControl?.(controlIndex, controlValue)
        )
    );
    this.wasmMidiCtxPtr = ctxPtr;

    const midiMsgHandlerCb = (evt: Event & { data: Uint8Array }) =>
      midiModule.handle_midi_evt(evt.data, ctxPtr);
    input.addEventListener('midimessage', midiMsgHandlerCb);

    this.midiInput = input;
    this.midiMsgHandlerCb = midiMsgHandlerCb;
  }

  constructor(
    ctx: AudioContext,
    midiNode: MIDINode,
    initialSelectedInputName?: string | undefined
  ) {
    this.pitchBendNode = new ConstantSourceNode(ctx);
    this.pitchBendNode.offset.value = 0;
    this.pitchBendNode.start();
    this.modWheelNode = new ConstantSourceNode(ctx);
    this.modWheelNode.offset.value = 0;
    this.modWheelNode.start();
    this.midiNode = midiNode;

    this.selectedInputName = initialSelectedInputName;

    this.initMIDI();
  }

  public serialize() {
    return { inputName: this.selectedInputName };
  }

  public handleSelectedInputName(newInputName: string | undefined) {
    if (this.selectedInputName === newInputName) {
      return;
    }

    if (this.wasmMidiCtxPtr && this.midiModule) {
      this.midiModule.drop_msg_handler_ctx(this.wasmMidiCtxPtr);
      this.wasmMidiCtxPtr = 0;
      if (this.midiInput && this.midiMsgHandlerCb) {
        this.midiInput.removeEventListener('midimessage', this.midiMsgHandlerCb);
      }
    }

    this.selectedInputName = newInputName;

    if (!R.isNil(this.selectedInputName)) {
      this.initMIDI();
    }
  }

  public async getMidiInputNames(): Promise<string[]> {
    if (this.midiAccess) {
      const inputNames: string[] = [];
      for (const [, input] of this.midiAccess.inputs) {
        if (input.name.toLowerCase().includes('midi through port')) {
          continue;
        }
        inputNames.push(input.name);
      }
      return inputNames;
    }

    return new Promise(resolve => {
      this.onInitCbs.push(async () => resolve(await this.getMidiInputNames()));
    });
  }

  public disconnectMidiNode() {
    this.midiNode = undefined;
  }

  public connectMidiNode(midiNode: MIDINode) {
    this.midiNode = midiNode;
  }
}
