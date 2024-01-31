import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';

import {
  get_midi_keyboard_audio_connectables,
  type MappedOutput,
  type MIDIKeyboardCtx,
  midiKeyboardCtxByStateKey,
} from 'src/midiKeyboard';
import { MIDIInput } from 'src/midiKeyboard/midiInput';
import { updateConnectables } from 'src/patchNetwork/interface';
import { UnreachableError, mkLinearToLog } from 'src/util';

const ctx = new AudioContext();

const getVCId = (stateKey: string) => stateKey.split('_')[1]!;

export enum MidiKeyboardMode {
  /**
   * Uses an external MIDI device connected via WebMIDI
   */
  MidiInput,
  /**
   * Uses the normal computer keyboard keys to send MIDI events
   */
  ComputerKeyboard,
}

export interface MidiKeyboardMappedOutputDescriptor {
  controlIndex: number;
  scale: number;
  shift: number;
  logScale: boolean;
}

export interface MidiKeyboardStateItem {
  mode: MidiKeyboardMode;
  midiInput: MIDIInput | undefined;
  midiInputName: string | undefined;
  octaveOffset: number;
  mappedOutputs: MidiKeyboardMappedOutputDescriptor[];
}

export type MidiKeyboardState = { [stateKey: string]: MidiKeyboardStateItem };

const getMidiKeyboardCtx = (stateKey: string): MIDIKeyboardCtx => {
  const midiKeyboardCtx = midiKeyboardCtxByStateKey.get(stateKey);
  if (!midiKeyboardCtx) {
    throw new UnreachableError(`No ctx entry found for midi keyboard state key ${stateKey}`);
  }
  return midiKeyboardCtx;
};

export const computeMappedOutputValue = (
  outputDescriptor: MidiKeyboardMappedOutputDescriptor,
  rawValue: number
): number => {
  if (!outputDescriptor.logScale) {
    return rawValue * outputDescriptor.scale + outputDescriptor.shift;
  }

  let [logmin, logmax] = [
    0 * outputDescriptor.scale + outputDescriptor.shift,
    127 * outputDescriptor.scale + outputDescriptor.shift,
  ] as const;
  if (logmin === 0) {
    logmin = Math.sign(logmax) * 1e-6;
  }
  if (logmax === 0) {
    logmax = Math.sign(logmin) * 1e-6;
  }
  const logValue = mkLinearToLog(logmin, logmax, 1)((rawValue / 127) * 100);
  return logValue;
};

/**
 * Updates the underlying CSN for a mapped output, re-computing its value based on the last recorded raw value
 */
const updateMappedOutputCSN = (
  stateKey: string,
  outputIx: number,
  outputDescriptor: MidiKeyboardMappedOutputDescriptor
) => {
  const midiKeyboardCtx = getMidiKeyboardCtx(stateKey);
  const lastRawValue =
    midiKeyboardCtx.lastSeenRawMIDIControlValuesByControlIndex.get(outputDescriptor.controlIndex) ??
    0;

  const output = midiKeyboardCtx.mappedOutputs[outputIx];
  if (!output) {
    throw new UnreachableError(`No mapped output found at index ${outputIx}`);
  }

  const outputValue = computeMappedOutputValue(outputDescriptor, lastRawValue);
  output.csn.offset.value = outputValue;
};

export const buildFreshOutputDescriptorsByControlIndex = (
  mappedOutputs: MIDIKeyboardCtx['mappedOutputs'],
  mappedOutputDescriptors: MidiKeyboardMappedOutputDescriptor[]
): Map<
  number,
  { output: MappedOutput; outputDescriptor: MidiKeyboardMappedOutputDescriptor }[]
> => {
  const map: Map<
    number,
    { output: MappedOutput; outputDescriptor: MidiKeyboardMappedOutputDescriptor }[]
  > = new Map();

  mappedOutputDescriptors.forEach((outputDescriptor, outputIx) => {
    const output = mappedOutputs[outputIx];
    if (!output) {
      throw new UnreachableError(`No mapped output found at index ${outputIx}`);
    }

    const existing = map.get(outputDescriptor.controlIndex);
    if (existing) {
      existing.push({ output, outputDescriptor });
      return;
    }

    map.set(outputDescriptor.controlIndex, [{ output, outputDescriptor }]);
  });

  return map;
};

const buildMappedOutputName = (
  existingMappedOutputs: MappedOutput[],
  controlIndex: number
): string => {
  const base = `midi control index ${controlIndex}`;
  if (!existingMappedOutputs.some(output => output.name === base)) {
    return base;
  }

  let offset = 1;
  let renamed = `${base} (${offset})`;
  while (existingMappedOutputs.some(output => output.name === renamed)) {
    offset += 1;
    renamed = `${base} (${offset})`;
  }

  return renamed;
};

const DEFAULT_MIDI_KEYBOARD_STATE_ITEM: MidiKeyboardStateItem = {
  mode: MidiKeyboardMode.ComputerKeyboard,
  midiInput: undefined,
  midiInputName: undefined,
  octaveOffset: 2,
  mappedOutputs: [],
};

const getInstance = (state: MidiKeyboardState, stateKey: string): MidiKeyboardStateItem | null => {
  const instanceState = state[stateKey];
  if (!instanceState) {
    console.error(
      `Tried to retrieve MIDI keyboard state for stateKey ${stateKey} but it wasn't set`
    );
    return null;
  }
  return instanceState;
};

const actionGroups = {
  ADD_MIDI_KEYBOARD: buildActionGroup({
    actionCreator: (stateKey: string, initialState?: MidiKeyboardStateItem) => ({
      type: 'ADD_MIDI_KEYBOARD',
      stateKey,
      initialState,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, initialState }) => ({
      ...state,
      [stateKey]: initialState || DEFAULT_MIDI_KEYBOARD_STATE_ITEM,
    }),
  }),
  DELETE_MIDI_KEYBOARD: buildActionGroup({
    actionCreator: (stateKey: string) => ({ type: 'DELETE_MIDI_KEYBOARD', stateKey }),
    subReducer: (state: MidiKeyboardState, { stateKey }) => {
      const newState = { ...state };
      delete newState[stateKey];
      return newState;
    },
  }),
  SET_OCTAVE_OFFSET: buildActionGroup({
    actionCreator: (stateKey: string, octaveOffset: number) => ({
      type: 'SET_OCTAVE_OFFSET',
      stateKey,
      octaveOffset,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, octaveOffset }) => {
      const instanceState = getInstance(state, stateKey);
      if (!instanceState) {
        return state;
      }
      return { ...state, [stateKey]: { ...instanceState, octaveOffset } };
    },
  }),
  SET_MIDI_INPUT_NAME: buildActionGroup({
    actionCreator: (stateKey: string, midiInputName: string | undefined) => ({
      type: 'SET_MIDI_INPUT_NAME',
      stateKey,
      midiInputName,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, midiInputName }) => {
      if (!state[stateKey].midiInput) {
        throw new UnreachableError(
          `No \`midiInput\` for stateKey=${stateKey} but we're handling input change`
        );
      }
      if (midiInputName) {
        const midiNode = midiKeyboardCtxByStateKey.get(stateKey)?.midiNode;
        if (!midiNode) {
          throw new UnreachableError(
            'No MIDI node found for midi keyboard with `stateKey`: ' + stateKey
          );
        }
        state[stateKey].midiInput!.connectMidiNode(midiNode);
        state[stateKey].midiInput!.handleSelectedInputName(midiInputName);
      } else {
        state[stateKey].midiInput!.disconnectMidiNode();
      }

      return {
        ...state,
        [stateKey]: {
          ...state[stateKey],
          midiInputName: midiInputName ? midiInputName : undefined,
        },
      };
    },
  }),
  SET_MIDI_INPUT_MODE: buildActionGroup({
    actionCreator: (stateKey: string, mode: MidiKeyboardMode) => ({
      type: 'SET_MIDI_INPUT_MODE',
      stateKey,
      mode,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, mode }) => {
      const mutableCtx = midiKeyboardCtxByStateKey.get(stateKey);
      if (!mutableCtx) {
        throw new UnreachableError(
          'No mutable ctx found for midi keyboard with `stateKey`: ' + stateKey
        );
      }

      const buildMIDIInput = () => {
        const midiInput = new MIDIInput(ctx, mutableCtx.midiNode, state[stateKey].midiInputName);
        midiInput.modWheelNode.offset.value = mutableCtx.lastSeenModWheel;
        midiInput.pitchBendNode.offset.value = mutableCtx.lastSeenPitchBend;
        return midiInput;
      };

      const midiInput =
        state[stateKey].midiInput ??
        (mode === MidiKeyboardMode.MidiInput ? buildMIDIInput() : undefined);

      if (mode !== MidiKeyboardMode.MidiInput && state[stateKey].midiInput) {
        state[stateKey].midiInput!.disconnectMidiNode();
      } else if (mode === MidiKeyboardMode.MidiInput) {
        if (state[stateKey].midiInput) {
          state[stateKey].midiInput!.connectMidiNode(mutableCtx.midiNode);
        } else {
          state[stateKey].midiInput = buildMIDIInput();
        }
      }

      setTimeout(() =>
        updateConnectables(getVCId(stateKey), get_midi_keyboard_audio_connectables(stateKey))
      );

      return {
        ...state,
        [stateKey]: { ...state[stateKey], midiInput, mode },
      };
    },
  }),
  ADD_NEW_MAPPED_OUTPUT: buildActionGroup({
    actionCreator: (stateKey: string, controlIndex: number) => ({
      type: 'ADD_NEW_MAPPED_OUTPUT' as const,
      stateKey,
      controlIndex,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, controlIndex }) => {
      const midiKeyboardCtx = getMidiKeyboardCtx(stateKey);
      const csn = ctx.createConstantSource();
      csn.offset.value = 0;
      csn.start();
      midiKeyboardCtx.mappedOutputs.push({
        csn,
        name: buildMappedOutputName(midiKeyboardCtx.mappedOutputs, controlIndex),
      });

      setTimeout(() =>
        updateConnectables(getVCId(stateKey), get_midi_keyboard_audio_connectables(stateKey))
      );

      const inst = state[stateKey];
      const newOutput: MidiKeyboardMappedOutputDescriptor = {
        controlIndex,
        scale: 1,
        shift: 0,
        logScale: false,
      };
      const newInst = { ...inst, mappedOutputs: [...inst.mappedOutputs, newOutput] };

      midiKeyboardCtx.outputDescriptorsByControlIndex = buildFreshOutputDescriptorsByControlIndex(
        midiKeyboardCtx.mappedOutputs,
        newInst.mappedOutputs
      );

      return { ...state, [stateKey]: newInst };
    },
  }),
  SET_MAPPED_OUTPUT_PARAMS: buildActionGroup({
    actionCreator: (
      stateKey: string,
      outputIx: number,
      scale: number,
      shift: number,
      logScale: boolean
    ) => ({
      type: 'SET_MAPPED_OUTPUT_PARAMS',
      outputIx,
      stateKey,
      scale,
      shift,
      logScale,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, outputIx, scale, shift, logScale }) => {
      const newOutputDescriptor = {
        ...state[stateKey].mappedOutputs[outputIx],
        scale,
        shift,
        logScale,
      };
      updateMappedOutputCSN(stateKey, outputIx, newOutputDescriptor);
      const ctx = getMidiKeyboardCtx(stateKey);

      const newInst = {
        ...state[stateKey],
        mappedOutputs: R.set(
          R.lensIndex(outputIx),
          newOutputDescriptor,
          state[stateKey].mappedOutputs
        ),
      };

      ctx.outputDescriptorsByControlIndex = buildFreshOutputDescriptorsByControlIndex(
        ctx.mappedOutputs,
        newInst.mappedOutputs
      );

      return { ...state, [stateKey]: newInst };
    },
  }),
  REMOVE_MAPPED_OUTPUT: buildActionGroup({
    actionCreator: (stateKey: string, outputIx: number) => ({
      type: 'REMOVE_MAPPED_OUTPUT',
      stateKey,
      outputIx,
    }),
    subReducer: (state: MidiKeyboardState, { stateKey, outputIx }) => {
      const ctx = getMidiKeyboardCtx(stateKey);
      ctx.mappedOutputs = R.remove(outputIx, 1, ctx.mappedOutputs);

      setTimeout(() =>
        updateConnectables(getVCId(stateKey), get_midi_keyboard_audio_connectables(stateKey))
      );

      const inst = state[stateKey];
      const newInst = { ...inst, mappedOutputs: R.remove(outputIx, 1, inst.mappedOutputs) };

      ctx.outputDescriptorsByControlIndex = buildFreshOutputDescriptorsByControlIndex(
        ctx.mappedOutputs,
        newInst.mappedOutputs
      );

      return { ...state, [stateKey]: newInst };
    },
  }),
};

export default buildModule<MidiKeyboardState, typeof actionGroups>({}, actionGroups);
