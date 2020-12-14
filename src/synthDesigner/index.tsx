import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Try, Option } from 'funfix-core';
import { buildStore } from 'jantix';
import { reducer as formReducer } from 'redux-form';
import { Map as ImmMap } from 'immutable';

import {
  SynthDesignerState,
  serializeSynthModule,
  deserializeSynthModule,
  getInitialSynthDesignerState,
  Waveform,
  PolysynthMod,
} from 'src/redux/modules/synthDesigner';
import SynthDesigner from './SynthDesigner';
import { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import synthDesignerModule from 'src/redux/modules/synthDesigner';
import { buildMIDINode, MIDINode } from 'src/patchNetwork/midiNode';
import { midiToFrequency } from 'src/util';

const buildSynthDesignerRedux = () => {
  const modules = {
    synthDesigner: synthDesignerModule,
  };

  return buildStore<typeof modules>(modules, undefined, { form: formReducer });
};

export type SynthDesignerReduxInfra = ReturnType<typeof buildSynthDesignerRedux>;

export type SynthDesignerReduxStore = ReturnType<
  ReturnType<typeof buildSynthDesignerRedux>['getState']
>;

const getRootNodeId = (vcId: string) => `synth-designer-react-root_${vcId}`;

/**
 * Global map of state key to Redux infrastructure
 */
let STATE_MAP: ImmMap<
  string,
  ReturnType<typeof buildSynthDesignerRedux> & { reactRoot: unknown }
> = ImmMap();

export const getReduxInfra = (stateKey: string) => {
  const reduxInfra = STATE_MAP.get(stateKey);
  if (!reduxInfra) {
    throw new Error(`No Redux state entry for state key "${stateKey}"`);
  }

  return reduxInfra;
};

export const init_synth_designer = (stateKey: string) => {
  // Create a fresh Redux store just for this instance.  It makes things a lot simpler on the Redux side due to the
  // complexity of the Redux architecture for synth designer; we'd have to add an id param to all actions and store
  // everything in a big map.
  const reduxInfra = buildSynthDesignerRedux();
  STATE_MAP = STATE_MAP.set(stateKey, { ...reduxInfra, reactRoot: 'NOT_LOADED' });

  // Retrieve the initial synth designer content from `localStorage` (if it's set)
  const initialState = Try.of(() =>
    Option.of(localStorage.getItem(stateKey))
      .map(serializedState => JSON.parse(serializedState))
      .map(
        ({ synths, ...rest }) =>
          ({
            synths: (synths as any[]).map((synth, i) =>
              deserializeSynthModule(synth, reduxInfra.dispatch, i)
            ),
            spectrumNode: new AnalyserNode(new AudioContext()),
            ...rest,
            isHidden: false,
          } as SynthDesignerState)
      )
      .orNull()
  )
    .recoverWith(err => {
      console.warn(
        'Error deserializing synth designer state from JSON; clearing and defaulting to empty',
        err
      );

      return Try.failure(err);
    })
    .getOrElseL(() => {
      localStorage.removeItem(stateKey);
      return getInitialSynthDesignerState(true);
    });

  PolysynthMod.get().then(mod => {
    const playNote = (voiceIx: number, note: number, velocity: number, offset?: number) =>
      reduxInfra.dispatch(
        reduxInfra.actionCreators.synthDesigner.GATE(
          midiToFrequency(note),
          voiceIx,
          undefined,
          offset
        )
      );

    const releaseNote = (voiceIx: number, note: number, velocity: number, offset?: number) =>
      reduxInfra.dispatch(
        reduxInfra.actionCreators.synthDesigner.UNGATE(
          () => reduxInfra.getState().synthDesigner,
          voiceIx,
          undefined,
          offset
        )
      );

    const ctxPtr = mod.create_polysynth_context(playNote, releaseNote);
    reduxInfra.dispatch(
      reduxInfra.actionCreators.synthDesigner.SET_POLYSYNTH_CTX({ ctxPtr, module: mod })
    );
  });

  if (initialState) {
    reduxInfra.dispatch(reduxInfra.actionCreators.synthDesigner.SET_STATE(initialState));
  }

  // Create the base dom node for the faust editor
  const synthDesignerBase = document.createElement('div');
  const vcId = stateKey.split('_')[1]!;
  synthDesignerBase.id = getRootNodeId(vcId);
  synthDesignerBase.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(synthDesignerBase);

  const reactRoot = ReactDOM.unstable_createRoot(synthDesignerBase);
  reactRoot.render(
    <Provider store={reduxInfra.store}>
      <SynthDesigner stateKey={stateKey} />
    </Provider>
  );
  STATE_MAP.get(stateKey)!.reactRoot = reactRoot;
};

export const hide_synth_designer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const reduxInfra = getReduxInfra(stateKey);
  reduxInfra.dispatch(reduxInfra.actionCreators.synthDesigner.SET_SYNTH_DESIGNER_IS_HIDDEN(true));

  const rootNode = document.getElementById(getRootNodeId(vcId));
  if (!rootNode) {
    console.warn(`Tried to hide synth designer with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'none';
};

export const unhide_synth_designer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const reduxInfra = getReduxInfra(stateKey);
  reduxInfra.dispatch(reduxInfra.actionCreators.synthDesigner.SET_SYNTH_DESIGNER_IS_HIDDEN(false));

  const rootNode = document.getElementById(getRootNodeId(vcId));
  if (!rootNode) {
    console.warn(`Tried to unhide synth designer with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'block';
};

export const cleanup_synth_designer = (stateKey: string): string => {
  const { synths } = getReduxInfra(stateKey).getState().synthDesigner;
  const designerState = JSON.stringify({ synths: synths.map(serializeSynthModule) });
  const vcId = stateKey.split('_')[1]!;
  const rootNode = document.getElementById(getRootNodeId(vcId));
  if (!rootNode) {
    return designerState;
  }

  const state = STATE_MAP.get(stateKey);
  if (!state) {
    console.error(
      'Missing state map entry for synth designer when cleaning up, stateKey=' + stateKey
    );
  } else {
    state.reactRoot.unmount();
  }
  rootNode.remove();
  return designerState;
};

const midiInputCbCache: Map<string, MIDINode> = new Map();

const getMidiNode = (stateKey: string): MIDINode => {
  const cached = midiInputCbCache.get(stateKey);
  if (cached) {
    return cached;
  }

  const midiNode = buildMIDINode(() => {
    const { dispatch, getState, actionCreators } = getReduxInfra(stateKey);

    const onAttack = (note: number, velocity: number, offset?: number) => {
      const polysynthCtx = getState().synthDesigner.polysynthCtx;
      if (!polysynthCtx) {
        return;
      }

      polysynthCtx.module.handle_note_down(polysynthCtx.ctxPtr, note, velocity, offset);
    };

    const onRelease = (note: number, velocity: number, offset?: number) => {
      const polysynthCtx = getState().synthDesigner.polysynthCtx;
      if (!polysynthCtx) {
        return;
      }

      polysynthCtx.module.handle_note_up(polysynthCtx.ctxPtr, note, offset);
    };

    return {
      onAttack,
      onRelease,
      onPitchBend: () => {
        // No-op; TODO?
      },
      onClearAll: (stopPlayingNotes: boolean) =>
        dispatch(actionCreators.synthDesigner.CLEAR_ALL_SCHEDULED_MIDI_EVENTS(stopPlayingNotes)),
    };
  });
  midiInputCbCache.set(stateKey, midiNode);
  return midiNode;
};

export const getVoicePreset = (stateKey: string, synthIx: number) => {
  const voiceState = getReduxInfra(stateKey).getState().synthDesigner.synths[synthIx];
  // TODO: Handle wavetable bodies as well
  return { type: 'standard', ...serializeSynthModule(voiceState) };
};

export const get_synth_designer_audio_connectables = (stateKey: string): AudioConnectables => {
  const { synths, spectrumNode } = getReduxInfra(stateKey).getState().synthDesigner;

  return {
    vcId: stateKey.split('_')[1]!,
    inputs: synths
      .reduce((acc, synth, i) => {
        const inputsForSynth = acc
          .set(`synth_${i}_detune`, { node: synth.detuneCSN.offset, type: 'number' })
          .set(`synth_${i}_filter_frequency`, {
            node: synth.filterCSNs.frequency.offset,
            type: 'number',
          })
          .set(`synth_${i}_filter_q`, { node: synth.filterCSNs.Q.offset, type: 'number' })
          .set(`synth_${i}_filter_detune`, {
            node: synth.filterCSNs.detune.offset,
            type: 'number',
          });

        if (synth.waveform !== Waveform.Wavetable) {
          return inputsForSynth;
        }

        const withIntraMixInputs = synth.wavetableInputControls!.intraDimMixes.reduce(
          (acc, param, dimIx) => acc.set(`dim_${dimIx}_mix`, { node: param, type: 'number' }),
          inputsForSynth
        );
        return synth.wavetableInputControls!.interDimMixes.reduce(
          (acc, param, dimIx) =>
            acc.set(`dim_${dimIx}x${dimIx + 1}_mix`, { node: param, type: 'number' }),
          withIntraMixInputs
        );
      }, ImmMap<string, ConnectableInput>())
      .set('midi', { node: getMidiNode(stateKey), type: 'midi' }),
    outputs: ImmMap<string, ConnectableOutput>().set('masterOutput', {
      node: spectrumNode,
      type: 'customAudio',
    }),
  };
};
