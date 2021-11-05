/**
 * View context that creates a MIDI keyboard that is controllable via the normal keyboard and capable of being
 * connected to MIDI modules.
 */
import { Map as ImmMap } from 'immutable';
import { UnreachableException } from 'ameo-utils';

import { MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { MidiKeyboardVC, MidiKeyboardVCProps } from 'src/midiKeyboard/MidiKeyboard';
import { store, dispatch, actionCreators, getState } from 'src/redux';
import {
  computeMappedOutputValue,
  MidiKeyboardMappedOutputDescriptor,
  MidiKeyboardMode,
  MidiKeyboardStateItem,
} from 'src/redux/modules/midiKeyboard';
import { tryParseJson } from 'src/util';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { MIDIInput } from 'src/midiKeyboard/midiInput';
import { create_empty_audio_connectables } from 'src/redux/modules/vcmUtils';

const ctx = new AudioContext();

interface SerializedMidiKeyboardState extends Omit<MidiKeyboardStateItem, 'midiInput'> {
  lastSeenRawMIDIControlValuesByControlIndex: { [controlIndex: number]: number };
  lastSeenPitchBend: number;
  lastSeenModWheel: number;
  midiInput?: null;
  mappedOutputs: (MidiKeyboardMappedOutputDescriptor & { name: string })[];
}

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
}

export const midiKeyboardCtxByStateKey: Map<string, MIDIKeyboardCtx> = new Map();

const getMidiKeyboardDomId = (vcId: string) => `midiKeyboard_${vcId}`;

export const init_midi_keyboard = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const midiNode = new MIDINode();
  const midiKeyboardCtx = {
    midiNode,
    lastSeenPitchBend: 0,
    lastSeenModWheel: 0,
    mappedOutputs: [] as MappedOutput[],
    lastSeenRawMIDIControlValuesByControlIndex: new Map(),
  };
  midiKeyboardCtxByStateKey.set(stateKey, midiKeyboardCtx);

  // Spy on generic control values produced by the underlying MIDI Node and udpate the last seen raw values map
  let uiGenericControlCbs: ((controlIndex: number, controlValue: number) => void)[] = [];
  const genericControlRecorderCBs: MIDIInputCbs = {
    onAttack: (_note, _velocity) => {
      // no-op
    },
    onRelease: (_note, _velocity) => {
      // no-op
    },
    onPitchBend: _bendAmount => {
      // no-op
    },
    onClearAll: () => {
      // no-op
    },
    onGenericControl: (controlIndex: number, controlValue: number) => {
      midiKeyboardCtx.lastSeenRawMIDIControlValuesByControlIndex.set(controlIndex, controlValue);
      uiGenericControlCbs.forEach(cb => cb(controlIndex, controlValue));
    },
  };
  midiNode.connect(new MIDINode(() => genericControlRecorderCBs));

  const elem = document.createElement('div');
  elem.id = getMidiKeyboardDomId(vcId);
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0;'
  );
  document.getElementById('content')!.appendChild(elem);

  const initialState = tryParseJson<SerializedMidiKeyboardState, undefined>(
    localStorage.getItem(stateKey)!,
    undefined,
    `Failed to parse localStorage state for MIDI keyboard with stateKey ${stateKey}; reverting to initial state.`
  );

  if (initialState) {
    for (const [controlIndex, controlValue] of Object.entries(
      initialState.lastSeenRawMIDIControlValuesByControlIndex
    )) {
      midiKeyboardCtx.lastSeenRawMIDIControlValuesByControlIndex.set(controlIndex, controlValue);
    }

    midiKeyboardCtx.lastSeenModWheel = initialState.lastSeenModWheel;
    midiKeyboardCtx.lastSeenPitchBend = initialState.lastSeenPitchBend;

    midiKeyboardCtx.mappedOutputs = initialState.mappedOutputs.map(outputDescriptor => {
      const csn = ctx.createConstantSource();
      csn.offset.value = computeMappedOutputValue(
        outputDescriptor,
        midiKeyboardCtx.lastSeenRawMIDIControlValuesByControlIndex.get(
          outputDescriptor.controlIndex
        ) ?? 0
      );

      return { name: outputDescriptor.name, csn };
    });
  }

  const initialReduxState = initialState
    ? {
        ...initialState,
        midiInput:
          initialState.mode === MidiKeyboardMode.MidiInput
            ? new MIDIInput(ctx, midiNode, initialState.midiInputName)
            : undefined,
      }
    : undefined;

  if (initialReduxState && initialState && initialReduxState.midiInput) {
    initialReduxState.midiInput.pitchBendNode.offset.value = initialState.lastSeenPitchBend;
    initialReduxState.midiInput.modWheelNode.offset.value = initialState.lastSeenModWheel;
  }

  dispatch(actionCreators.midiKeyboard.ADD_MIDI_KEYBOARD(stateKey, initialReduxState));

  const props: MidiKeyboardVCProps = {
    stateKey,
    registerGenericControlCb: cb => uiGenericControlCbs.push(cb),
    deregisterGenericControlCb: cb => {
      uiGenericControlCbs = uiGenericControlCbs.filter(ocb => ocb !== cb);
    },
  };
  mkContainerRenderHelper({
    Comp: MidiKeyboardVC,
    getProps: () => props,
    store,
  })(getMidiKeyboardDomId(vcId));
};

const getMidiKeyboardDomElem = (stateKey: string): HTMLDivElement | null => {
  const vcId = stateKey.split('_')[1]!;

  const elem = document.getElementById(getMidiKeyboardDomId(vcId));
  if (!elem) {
    console.warn(`Tried to get MIDI keyboard DOM node with VC ID ${vcId} but it wasn't mounted`);
    return null;
  }

  return elem as HTMLDivElement;
};

export const cleanup_midi_keyboard = (stateKey: string): string => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = midiKeyboardCtxByStateKey.get(stateKey);
  if (!ctx) {
    throw new UnreachableException(
      `No MIDI keyboard instance found for state key ${stateKey} when cleaning up`
    );
  }
  midiKeyboardCtxByStateKey.delete(stateKey);

  const elem = getMidiKeyboardDomElem(stateKey);
  if (!elem) {
    return '';
  }

  mkContainerCleanupHelper()(getMidiKeyboardDomId(vcId));

  const instanceState = getState().midiKeyboard[stateKey];
  // TODO: Store last received values for mapped outputs
  if (!instanceState) {
    console.error(`No MIDI keyboard state for MIDI keyboard with state key ${stateKey}`);
    return '';
  }

  const lastSeenRawMIDIControlValuesByControlIndex: { [controlIndex: number]: number } = {};
  for (const [
    controlIndex,
    controlValue,
  ] of ctx.lastSeenRawMIDIControlValuesByControlIndex.entries()) {
    lastSeenRawMIDIControlValuesByControlIndex[controlIndex] = controlValue;
  }
  const toSerialize: SerializedMidiKeyboardState = {
    ...instanceState,
    midiInput: null,
    lastSeenModWheel: instanceState.midiInput?.modWheelNode.offset.value ?? 0,
    lastSeenPitchBend: instanceState.midiInput?.pitchBendNode.offset.value ?? 0,
    lastSeenRawMIDIControlValuesByControlIndex,
    mappedOutputs: instanceState.mappedOutputs.map((descriptor, outputIx) => ({
      ...descriptor,
      name: ctx.mappedOutputs[outputIx].name,
    })),
  };
  delete toSerialize.midiInput;
  return JSON.stringify(toSerialize);
};

export const hide_midi_keyboard = (stateKey: string) => {
  const elem = getMidiKeyboardDomElem(stateKey);

  if (elem) {
    elem.style.display = 'none';
  }
};

export const unhide_midi_keyboard = (stateKey: string) => {
  const elem = getMidiKeyboardDomElem(stateKey);

  if (elem) {
    elem.style.display = 'block';
  }
};

export const get_midi_keyboard_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = midiKeyboardCtxByStateKey.get(stateKey);
  if (!ctx) {
    console.warn(`No ctx found for midi keyboard VC with VC ID "${vcId}"`);
    return create_empty_audio_connectables(vcId);
  }
  const reduxState = getState().midiKeyboard[stateKey];

  let baseOutputs = ImmMap<string, ConnectableOutput>().set('midi out', {
    node: ctx.midiNode,
    type: 'midi',
  });
  if (reduxState.midiInput) {
    baseOutputs = baseOutputs
      .set('pitch bend', { type: 'customAudio', node: reduxState.midiInput.pitchBendNode })
      .set('mod wheel', { type: 'customAudio', node: reduxState.midiInput.modWheelNode });
  }
  const outputs = ctx.mappedOutputs.reduce(
    (acc, output) => acc.set(output.name, { type: 'customAudio', node: output.csn }),
    baseOutputs
  );

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs,
  };
};
