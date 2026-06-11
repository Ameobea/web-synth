import { Map as ImmMap } from 'immutable';

import type { GenericControlCb } from 'src/midiKeyboard/MidiKeyboardOutputMappingConfigurator';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import { getState } from 'src/redux';
import {
  MidiKeyboardMode,
  type MidiKeyboardMappedOutputDescriptor,
} from 'src/redux/modules/midiKeyboard';
import { create_empty_audio_connectables } from 'src/redux/modules/vcmUtils';

export interface MappedOutput {
  csn: ConstantSourceNode;
  name: string;
}

export interface MIDIKeyboardCtx {
  midiNode: MIDINode;
  lastSeenPitchBend: number;
  lastSeenModWheel: number;
  mappedOutputs: MappedOutput[];
  lastSeenRawMIDIControlValuesByControlIndex: Map<number, number>;
  outputDescriptorsByControlIndex: Map<
    number,
    { output: MappedOutput; outputDescriptor: MidiKeyboardMappedOutputDescriptor }[]
  >;
  registerGenericControlCb: (cb: GenericControlCb) => void;
  deregisterGenericControlCb: (cb: GenericControlCb) => void;
}

export const MidiKeyboardCtxByStateKey: Map<string, MIDIKeyboardCtx> = new Map();

export const get_midi_keyboard_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = MidiKeyboardCtxByStateKey.get(stateKey);
  if (!ctx) {
    console.warn(`No ctx found for midi keyboard VC with VC ID "${vcId}"`);
    return create_empty_audio_connectables(vcId);
  }
  const reduxState = getState().midiKeyboard[stateKey];

  let baseOutputs = ImmMap<string, ConnectableOutput>().set('midi out', {
    node: ctx.midiNode,
    type: 'midi',
  });
  if (reduxState.midiInput && reduxState.mode === MidiKeyboardMode.MidiInput) {
    baseOutputs = baseOutputs
      .set('pitch bend', { type: 'number', node: reduxState.midiInput.pitchBendNode })
      .set('mod wheel', { type: 'number', node: reduxState.midiInput.modWheelNode });
  }
  const outputs =
    reduxState.mode === MidiKeyboardMode.MidiInput
      ? ctx.mappedOutputs.reduce(
          (acc, output) => acc.set(output.name, { type: 'number', node: output.csn }),
          baseOutputs
        )
      : baseOutputs;

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs,
  };
};
