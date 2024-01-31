/**
 * View context that creates a MIDI keyboard that is controllable via the normal keyboard and capable of being
 * connected to MIDI modules.
 */

import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import { MIDIInput } from 'src/midiKeyboard/midiInput';
import type { GenericControlCb } from 'src/midiKeyboard/MidiKeyboardOutputMappingConfigurator';
import {
  MidiKeyboardVC,
  type MidiKeyboardVCProps,
  mkMidiKeyboardSmallView,
} from 'src/midiKeyboard/MidiKeyboardVC';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { type MIDIInputCbs, MIDINode } from 'src/patchNetwork/midiNode';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { actionCreators, dispatch, getState, store } from 'src/redux';
import {
  buildFreshOutputDescriptorsByControlIndex,
  computeMappedOutputValue,
  type MidiKeyboardMappedOutputDescriptor,
  MidiKeyboardMode,
  type MidiKeyboardStateItem,
} from 'src/redux/modules/midiKeyboard';
import { create_empty_audio_connectables } from 'src/redux/modules/vcmUtils';
import { tryParseJson, UnreachableError } from 'src/util';

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
  outputDescriptorsByControlIndex: Map<
    number,
    { output: MappedOutput; outputDescriptor: MidiKeyboardMappedOutputDescriptor }[]
  >;
  registerGenericControlCb: (cb: GenericControlCb) => void;
  deregisterGenericControlCb: (cb: GenericControlCb) => void;
}

export const midiKeyboardCtxByStateKey: Map<string, MIDIKeyboardCtx> = new Map();

const getMidiKeyboardDomId = (vcId: string) => `midiKeyboard_${vcId}`;

export const init_midi_keyboard = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const midiNode = new MIDINode();
  let uiGenericControlCbs: ((controlIndex: number, controlValue: number) => void)[] = [];
  const midiKeyboardCtx: MIDIKeyboardCtx = {
    midiNode,
    lastSeenPitchBend: 0,
    lastSeenModWheel: 0,
    mappedOutputs: [] as MappedOutput[],
    lastSeenRawMIDIControlValuesByControlIndex: new Map(),
    outputDescriptorsByControlIndex: new Map(),
    registerGenericControlCb: cb => uiGenericControlCbs.push(cb),
    deregisterGenericControlCb: cb => {
      uiGenericControlCbs = uiGenericControlCbs.filter(ocb => ocb !== cb);
    },
  };
  midiKeyboardCtxByStateKey.set(stateKey, midiKeyboardCtx);

  // Spy on generic control values produced by the underlying MIDI Node and udpate the last seen raw values map

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
      // Dunno what these mean but they tend to spam sometimes
      if (controlIndex === 0) {
        return;
      }

      midiKeyboardCtx.lastSeenRawMIDIControlValuesByControlIndex.set(controlIndex, controlValue);
      uiGenericControlCbs.forEach(cb => cb(controlIndex, controlValue));
      midiKeyboardCtx.outputDescriptorsByControlIndex
        .get(controlIndex)
        ?.forEach(({ outputDescriptor, output }) => {
          const mappedValue = computeMappedOutputValue(outputDescriptor, controlValue);
          output.csn.offset.value = mappedValue;
        });
    },
  };
  midiNode.connect(new MIDINode(() => genericControlRecorderCBs));

  const elem = document.createElement('div');
  elem.id = getMidiKeyboardDomId(vcId);
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0;'
  );
  document.getElementById('content')!.appendChild(elem);

  const initialState = tryParseJson<SerializedMidiKeyboardState, undefined>(
    localStorage.getItem(stateKey)!,
    undefined,
    `Failed to parse localStorage state for MIDI keyboard with stateKey ${stateKey}; reverting to initial state.`
  );

  if (initialState) {
    for (const [controlIndex, controlValue] of Object.entries(
      initialState.lastSeenRawMIDIControlValuesByControlIndex ??
        ({} as { [controlIndex: number]: number })
    )) {
      midiKeyboardCtx.lastSeenRawMIDIControlValuesByControlIndex.set(+controlIndex, controlValue);
    }

    midiKeyboardCtx.lastSeenModWheel = initialState.lastSeenModWheel ?? 0;
    midiKeyboardCtx.lastSeenPitchBend = initialState.lastSeenPitchBend ?? 64;

    midiKeyboardCtx.mappedOutputs = (initialState.mappedOutputs ?? []).map(outputDescriptor => {
      const csn = ctx.createConstantSource();
      csn.offset.value = computeMappedOutputValue(
        outputDescriptor,
        midiKeyboardCtx.lastSeenRawMIDIControlValuesByControlIndex.get(
          outputDescriptor.controlIndex
        ) ?? 0
      );
      csn.start();

      return { name: outputDescriptor.name, csn };
    });

    midiKeyboardCtx.outputDescriptorsByControlIndex = buildFreshOutputDescriptorsByControlIndex(
      midiKeyboardCtx.mappedOutputs,
      initialState.mappedOutputs ?? []
    );
  }

  const initialReduxState = initialState
    ? {
        ...initialState,
        midiInput:
          initialState.mode === MidiKeyboardMode.MidiInput
            ? new MIDIInput(ctx, midiNode, initialState.midiInputName)
            : undefined,
        mappedOutputs: (initialState.mappedOutputs ?? []).map(descriptor =>
          R.pick(['controlIndex', 'scale', 'shift', 'logScale'], descriptor)
        ),
      }
    : undefined;

  if (initialReduxState && initialState && initialReduxState.midiInput) {
    initialReduxState.midiInput.pitchBendNode.offset.value = initialState.lastSeenPitchBend;
    initialReduxState.midiInput.modWheelNode.offset.value = initialState.lastSeenModWheel;
  }

  dispatch(actionCreators.midiKeyboard.ADD_MIDI_KEYBOARD(stateKey, initialReduxState));

  const props: MidiKeyboardVCProps = {
    stateKey,
    registerGenericControlCb: midiKeyboardCtx.registerGenericControlCb,
    deregisterGenericControlCb: midiKeyboardCtx.deregisterGenericControlCb,
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
    throw new UnreachableError(
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

export const render_midi_keyboard_small_view = (stateKey: string, domId: string) => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = midiKeyboardCtxByStateKey.get(stateKey);
  if (!ctx) {
    console.warn(`No ctx found for midi keyboard VC with VC ID "${vcId}"`);
    return create_empty_audio_connectables(vcId);
  }

  const props = {};
  mkContainerRenderHelper({
    Comp: mkMidiKeyboardSmallView(
      stateKey,
      ctx.registerGenericControlCb,
      ctx.deregisterGenericControlCb
    ),
    getProps: () => props,
    store,
  })(domId);
};

export const cleanup_midi_keyboard_small_view = (_vcId: string, domId: string) =>
  mkContainerCleanupHelper({ preserveRoot: true })(domId);
