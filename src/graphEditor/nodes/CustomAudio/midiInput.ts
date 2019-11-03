import { Map } from 'immutable';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import { AudioConnectables, MIDINode } from 'src/patchNetwork';

type PromiseResolveType<P> = P extends Promise<infer T> ? T : never;

type IterableValueOf<I> = I extends Iterable<[any, infer V]> ? V : never;

// hilarious
type MIDIAccess = PromiseResolveType<ReturnType<(typeof navigator)['requestMIDIAccess']>>;
type MIDIInput = IterableValueOf<MIDIAccess['inputs']>;

export const buildMIDINode = (getInputCbs: MIDINode['getInputCbs']): MIDINode => {
  let outputCbs: (ReturnType<MIDINode['getInputCbs']>)[] = [];

  return {
    outputCbs,
    connect: dst => {
      const inputCbs = dst.getInputCbs();
      // Make sure we're not already connected
      if (outputCbs.find(R.equals(inputCbs))) {
        console.warn('MIDI node already connected to destination');
        return;
      }

      outputCbs.push(inputCbs);
    },
    disconnect: dst => {
      if (!dst) {
        outputCbs = [];
        return;
      }

      const inputCbs = dst.getInputCbs();
      const beforeCbCount = outputCbs.length;
      outputCbs = outputCbs.filter(cbs => cbs !== inputCbs);

      if (beforeCbCount === outputCbs.length) {
        console.warn("Tried to disconnect two MIDI nodes but they weren't connected");
      }
    },
    getInputCbs,
  };
};

/**
 * Defines a custom audio node that processes MIDI events from some hardware MIDI device
 */
export class MIDIInputNode {
  public lgNode?: any;

  private vcId: string;
  private selectedInputName: string | undefined;
  private wasmMidiCtxPtr: number | undefined;
  private midiModule: typeof import('src/midi') | undefined;
  private midiInput: MIDIInput | undefined;
  private midiMsgHandlerCb: ((evt: Event & { data: Uint8Array }) => void) | undefined;

  public async updateInputs(providedAccess?: MIDIAccess) {
    const access = providedAccess || (await navigator.requestMIDIAccess());
    const allInputs: MIDIInput[] = [];
    for (const [, input] of access.inputs) {
      allInputs.push(input);
    }

    if (!R.isEmpty(allInputs)) {
      this.lgNode.addProperty('inputName', this.selectedInputName || allInputs[0].name, 'enum', {
        values: allInputs.map(R.prop('name')),
      });
    }
  }

  private midiNode: MIDINode = buildMIDINode(() => {
    throw new Error("Tried to get input callbacks for `MIDIInput` but it doesn't accept inputs");
  });

  private async initMIDI() {
    let access: PromiseResolveType<ReturnType<typeof navigator.requestMIDIAccess>>;
    let midiModule: typeof import('src/midi');
    try {
      // Request MIDI access and load the Wasm MIDI module at the same time
      [access, midiModule] = await Promise.all([
        navigator
          .requestMIDIAccess()
          .catch(err => `Error while attempting to get MIDI access: ${err}`),
        this.midiModule || import('src/midi'),
      ] as [Promise<typeof access>, Promise<typeof midiModule>]);
    } catch (err) {
      console.error(`Error while attempting to initialize MIDI input node: ${err}`);
      return;
    }

    if ((access.inputs as any).size === 0) {
      // No available MIDI inputs
      return;
    }

    this.midiModule = midiModule;

    if (this.lgNode) {
      this.updateInputs(access);
    }

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
        for (const [, input] of access.inputs) {
          return input;
        }

        throw new Error('Entered unreachable code');
      });

    // Register input handlers for the MIDI input so that MIDI events trigger our output callbacks
    // to be called appropriately.
    const ctxPtr = midiModule.create_msg_handler_context(
      (voiceIx: number, note: number, velocity: number) =>
        this.midiNode.outputCbs.forEach(({ onAttack }) => onAttack(note, voiceIx, velocity)),
      (voiceIx: number, note: number, velocity: number) =>
        this.midiNode.outputCbs.forEach(({ onRelease }) => onRelease(note, voiceIx, velocity)),
      (_lsb: number, msb: number) =>
        this.midiNode.outputCbs.forEach(({ onPitchBend }) => onPitchBend(msb))
    );
    this.wasmMidiCtxPtr = ctxPtr;

    const midiMsgHandlerCb = (evt: Event & { data: Uint8Array }) =>
      midiModule.handle_midi_evt(evt.data, ctxPtr);
    input.addEventListener('midimessage', midiMsgHandlerCb);

    this.midiInput = input;
    this.midiMsgHandlerCb = midiMsgHandlerCb;
  }

  constructor(vcId: string, params: { [key: string]: any } | null = {}, lgNode?: any) {
    this.vcId = vcId;
    this.lgNode = lgNode;

    if (params) {
      if (params.inputName !== undefined && typeof params.inputName !== 'string') {
        throw new Error(`Invalid type of \`inputName\`: ${typeof params.inputName}`);
      }

      this.selectedInputName = params.inputName;
    }

    this.initMIDI(); // Maybe a side-effectful constructor isn't the best idea but w/e
  }
  public serialize() {
    return { inputName: this.selectedInputName };
  }

  public handleSelectedInputName(newInputName: string) {
    if (this.selectedInputName === newInputName) {
      return;
    }

    if (this.wasmMidiCtxPtr && this.midiModule) {
      this.midiModule.drop_msg_handler_ctx(this.wasmMidiCtxPtr);
      if (this.midiInput && this.midiMsgHandlerCb) {
        this.midiInput.removeEventListener('midimessage', this.midiMsgHandlerCb);
      }
    }

    this.selectedInputName = newInputName;

    return this.initMIDI();
  }

  public buildConnectables(): AudioConnectables & { node: NonNullable<AudioConnectables['node']> } {
    return {
      inputs: Map<string, { node: AudioNode | AudioParam | MIDINode; type: string }>(),
      outputs: Map<string, { node: AudioNode | MIDINode; type: string }>().set('midi_output', {
        node: this.midiNode,
        type: 'midi',
      }),
      vcId: this.vcId,
      node: this,
    };
  }
}
