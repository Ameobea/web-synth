/**
 * View context that creates a MIDI keyboard that is controllable via the normal keyboard and capable of being
 * connected to MIDI modules.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import * as R from 'ramda';
import { Map } from 'immutable';

import { midiToFrequency } from 'src/util';
import { buildMIDINode, MIDINode } from 'src/patchNetwork/midiNode';
import Loading from 'src/misc/Loading';
import {
  create_empty_audio_connectables,
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
} from 'src/patchNetwork';

const START_NOTE = 33;

const keys = ['z', 's', 'x', 'c', 'f', 'v', 'g', 'b', 'n', 'j', 'm', 'k', ',', 'l', '.', '/'];

const keyMap: { [key: string]: number } = keys.reduce(
  (acc, key, i) => ({ ...acc, [key]: START_NOTE + i }),
  {}
);

declare interface MIDIInput extends EventTarget {
  name: string;
}

declare type MIDIOutputMap = Iterable<[string, MIDIInput]>;

declare interface MIDIAccess {
  sysexEnabled: boolean;
  outputs: MIDIOutputMap;
  inputs: MIDIOutputMap;
  onstatechange: null | ((evt: unknown) => void);
}

// Add in missing WebMIDI types to global scope
declare global {
  interface Navigator {
    requestMIDIAccess: () => Promise<MIDIAccess>;
  }
}

const tryInitMidi = async (
  playNote: (voiceIx: number, frequency: number, velocity: number) => void,
  releaseNote: (voiceIx: number, frequency: number, velocity: number) => void,
  handlePitchBend?: null | ((lsb: number, msb: number) => void)
): Promise<MIDIAccess> => {
  if (!navigator.requestMIDIAccess) {
    throw new Error(
      "Unable to initialize MIDI; no keyboard attached or browser doesn't support it"
    );
  }

  const access = await navigator.requestMIDIAccess();

  for (const [, input] of access.inputs) {
    if (!input.name.includes('KeyStep')) {
      continue;
    }

    const midiModule = await import('../midi');

    const ctxPtr = midiModule.create_msg_handler_context(playNote, releaseNote, handlePitchBend);

    input.addEventListener('midimessage', (evt: Event & { data: Uint8Array }) =>
      midiModule.handle_midi_evt(evt.data, ctxPtr)
    );
    break;
  }

  return access;
};

const MidiKeyboard: React.FC<{
  playNote: (voiceIx: number, frequency: number, velocity: number) => void;
  releaseNote: (voiceIx: number, frequency: number, velocity: number) => void;
  handlePitchBend?: ((lsb: number, msb: number) => void) | null;
}> = ({ playNote, releaseNote, handlePitchBend }) => {
  const midiAccess = useRef<MIDIAccess | null | 'INITIALIZING' | 'INIT_FAILED'>(null);

  useEffect(() => {
    if (!midiAccess.current) {
      midiAccess.current = 'INITIALIZING';
      tryInitMidi(playNote, releaseNote, handlePitchBend)
        .then(access => {
          midiAccess.current = access;
        })
        .catch(err => {
          console.warn(err);
          midiAccess.current = 'INIT_FAILED';
        });
    }

    const handleDown = (evt: KeyboardEvent) => {
      const midiNumber = keyMap[evt.key];
      if (R.isNil(midiNumber)) {
        return;
      }

      playNote(0, midiToFrequency(midiNumber), 255);
    };
    const handleUp = (evt: KeyboardEvent) => {
      const midiNumber = keyMap[evt.key];
      if (R.isNil(midiNumber)) {
        return;
      }

      releaseNote(0, midiToFrequency(midiNumber), 255);
    };

    document.addEventListener('keydown', handleDown);
    document.addEventListener('keyup', handleUp);

    return () => {
      document.removeEventListener('keydown', handleDown);
      document.removeEventListener('keyup', handleUp);
    };
  });

  return null;
};

let midiNodesByStateKey: Map<string, MIDINode> = Map();

/**
 * the component that is mounted to render the view context containing the inner `MidiKeyboard` component
 */
const MidiKeyboardVC: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const midiNode = useMemo(() => midiNodesByStateKey.get(stateKey), [stateKey]);
  if (!midiNode) {
    return <Loading />;
  }

  return (
    <MidiKeyboard
      playNote={(voiceIx, note, velocity) =>
        midiNode.outputCbs.forEach(cbs => cbs.onAttack(note, voiceIx, velocity))
      }
      releaseNote={(voiceIx, note, velocity) =>
        midiNode.outputCbs.forEach(cbs => cbs.onRelease(note, voiceIx, velocity))
      }
      handlePitchBend={(_lsb: number, msb: number) =>
        midiNode.outputCbs.forEach(cbs => cbs.onPitchBend(msb))
      }
    />
  );
};

const getMidiKeyboardDomId = (vcId: string) => `midiKeyboard_${vcId}`;

export const init_midi_keyboard = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  midiNodesByStateKey = midiNodesByStateKey.set(
    stateKey,
    buildMIDINode(() => {
      throw new Error('MIDI Keyboard does not accept MIDI input; it only creates output');
    })
  );

  const elem = document.createElement('div');
  elem.id = getMidiKeyboardDomId(vcId);
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;'
  );
  document.getElementById('content')!.appendChild(elem);

  ReactDOM.render(<MidiKeyboardVC stateKey={stateKey} />, elem);
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

export const cleanup_midi_keyboard = (stateKey: string) => {
  midiNodesByStateKey = midiNodesByStateKey.delete(stateKey);

  const elem = getMidiKeyboardDomElem(stateKey);

  if (!elem) {
    return;
  }

  ReactDOM.unmountComponentAtNode(elem);
  elem.remove();
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
  const midiNode = midiNodesByStateKey.get(stateKey);
  if (!midiNode) {
    console.warn(`No MIDI node found for VC with VC ID "${vcId}"`);
    return create_empty_audio_connectables(vcId);
  }

  return {
    vcId,
    inputs: Map<string, ConnectableInput>(),
    outputs: Map<string, ConnectableOutput>().set('midi out', { node: midiNode, type: 'midi' }),
  };
};
