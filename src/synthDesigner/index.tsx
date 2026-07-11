import { Option, Try } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import { PARAM_BUFFER_COUNT } from 'src/fmSynth/ParamSource';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { MIDINode } from 'src/patchNetwork/midiNode';
import buildSynthDesignerRedux, {
  deserializeSynthModule,
  disposeSynthModule,
  getInitialSynthDesignerState,
  getSynthDesignerReduxInfra,
  serializeSynthModule,
  SynthDesignerStateByStateKey,
  type SynthDesignerState,
  type SynthModule,
} from 'src/redux/modules/synthDesigner';
import type { WavyJones } from 'src/visualizations/WavyJones';
import { UnreachableError } from 'src/util';

export type SynthDesignerReduxInfra = ReturnType<typeof buildSynthDesignerRedux>;

export type SynthDesignerReduxStore = ReturnType<
  ReturnType<typeof buildSynthDesignerRedux>['getState']
>;

const getRootNodeId = (vcId: string) => `synth-designer-react-root_${vcId}`;

const buildSynthDesignerMIDINode = (): MIDINode =>
  new MIDINode(() => {
    return {
      enableRxAudioThreadScheduling: { mailboxIDs: [] },
      onAttack: () => {
        throw new UnreachableError(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
      onRelease: () => {
        throw new UnreachableError(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
      onPitchBend: () => {
        throw new UnreachableError(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
      onClearAll: () => {
        throw new UnreachableError(
          'Should never be called; should be handled by audio thread scheduling'
        );
      },
    };
  });

export const init_synth_designer = (stateKey: string) => {
  // Create a fresh Redux store just for this instance.  It makes things a lot simpler on the Redux side due to the
  // complexity of the Redux architecture for synth designer; we'd have to add an id param to all actions and store
  // everything in a big map.
  const vcId = stateKey.split('_')[1]!;

  // Retrieve the initial synth designer content from `localStorage` (if it's set)
  const initialState: SynthDesignerState | null = Try.of(() =>
    Option.of(localStorage.getItem(stateKey))
      .map(serializedState => JSON.parse(serializedState))
      .map(({ synths, ...rest }) => {
        // if a later voice fails to deserialize, dispose the already-built ones so their AWPs
        // don't leak as live zombie audio nodes after we fall back to the initial state
        const builtSynths: SynthModule[] = [];
        try {
          (synths as any[]).forEach((synth, i) =>
            builtSynths.push(deserializeSynthModule(undefined, synth, stateKey, i))
          );
        } catch (err) {
          builtSynths.forEach(disposeSynthModule);
          throw err;
        }
        return {
          synths: builtSynths,
          spectrumNode: new AnalyserNode(new AudioContext()),
          ...rest,
          isHidden: false,
        } as SynthDesignerState;
      })
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
      return getInitialSynthDesignerState(vcId);
    });

  const reduxInfra = buildSynthDesignerRedux(vcId, initialState);
  const midiNode = buildSynthDesignerMIDINode();
  SynthDesignerStateByStateKey.set(stateKey, { ...reduxInfra, reactRoot: 'NOT_LOADED', midiNode });

  if (initialState) {
    initialState.vcId = vcId;
    reduxInfra.dispatch(reduxInfra.actionCreators.synthDesigner.SET_STATE(initialState));
  }

  if ((window as any).isHeadless) {
    // The React tree normally dispatches this with a WavyJones oscilloscope (or a plain
    // `AnalyserNode` when WebGL is unavailable); it's what wires voice outputs through to
    // `spectrumNode`, so the audio path depends on it.
    reduxInfra.dispatch(
      reduxInfra.actionCreators.synthDesigner.SET_WAVY_JONES_INSTANCE(
        new AnalyserNode(new AudioContext())
      )
    );
    return;
  }

  // Create the base dom node for the faust editor
  const synthDesignerBase = document.createElement('div');
  synthDesignerBase.id = getRootNodeId(vcId);
  synthDesignerBase.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(synthDesignerBase);

  void Promise.all([
    import('./SynthDesigner'),
    import('react-dom/client'),
    import('react-redux'),
  ]).then(([{ default: SynthDesigner }, { createRoot }, { Provider }]) => {
    if (!synthDesignerBase.isConnected) {
      return;
    }

    const reactRoot = createRoot(synthDesignerBase);
    reactRoot.render(
      <Provider store={reduxInfra.store}>
        <SynthDesigner stateKey={stateKey} />
      </Provider>
    );
    SynthDesignerStateByStateKey.get(stateKey)!.reactRoot = reactRoot;
  });
};

export const hide_synth_designer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const reduxInfra = getSynthDesignerReduxInfra(stateKey);
  reduxInfra.dispatch(reduxInfra.actionCreators.synthDesigner.SET_SYNTH_DESIGNER_IS_HIDDEN(true));

  const rootNode = document.getElementById(getRootNodeId(vcId));
  if (!rootNode) {
    if (!(window as any).isHeadless) {
      console.warn(`Tried to hide synth designer with id ${vcId} but it wasn't mounted`);
    }
    return;
  }

  rootNode.style.display = 'none';
};

export const unhide_synth_designer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const reduxInfra = getSynthDesignerReduxInfra(stateKey);
  reduxInfra.dispatch(reduxInfra.actionCreators.synthDesigner.SET_SYNTH_DESIGNER_IS_HIDDEN(false));

  const rootNode = document.getElementById(getRootNodeId(vcId));
  if (!rootNode) {
    if (!(window as any).isHeadless) {
      console.warn(`Tried to unhide synth designer with id ${vcId} but it wasn't mounted`);
    }
    return;
  }

  rootNode.style.display = 'block';
};

const serializeSynthDesigner = (stateKey: string) => {
  const { synths } = getSynthDesignerReduxInfra(stateKey).getState().synthDesigner;
  return JSON.stringify({ synths: synths.map(serializeSynthModule) });
};

export const persist_synth_designer = (stateKey: string) => {
  const designerState = serializeSynthDesigner(stateKey);
  localStorage.setItem(stateKey, designerState);
};

export const cleanup_synth_designer = (stateKey: string): string => {
  const designerState = serializeSynthDesigner(stateKey);
  const vcId = stateKey.split('_')[1]!;

  const state = SynthDesignerStateByStateKey.get(stateKey);
  if (!state) {
    console.error(
      'Missing state map entry for synth designer when cleaning up, stateKey=' + stateKey
    );
  } else {
    if (state.reactRoot !== 'NOT_LOADED') {
      state.reactRoot.unmount();
    }

    const synthState = state.getState().synthDesigner;
    synthState.synths.forEach(disposeSynthModule);
    if (synthState.wavyJonesInstance) {
      synthState.wavyJonesInstance.disconnect();
      cancelAnimationFrame((synthState.wavyJonesInstance as WavyJones).animationFrameHandle);
    }
    synthState.spectrumNode.disconnect();
    state.midiNode.dispose();
  }

  SynthDesignerStateByStateKey.delete(stateKey);
  document.getElementById(getRootNodeId(vcId))?.remove();
  return designerState;
};

export const getVoicePreset = (stateKey: string, synthIx: number) => {
  const voiceState = getSynthDesignerReduxInfra(stateKey).getState().synthDesigner.synths[synthIx];
  return serializeSynthModule(voiceState);
};

export const get_synth_designer_audio_connectables = (stateKey: string): AudioConnectables => {
  const { getState, midiNode } = getSynthDesignerReduxInfra(stateKey);
  const { synths, spectrumNode } = getState().synthDesigner;

  return {
    vcId: stateKey.split('_')[1]!,
    inputs: synths
      .reduce((acc, synth, voiceIx) => {
        const inputsForSynth = acc
          .set(`synth_${voiceIx}_filter_frequency`, {
            node: synth.filterCSNs.frequency,
            type: 'number',
          })
          .set(`synth_${voiceIx}_filter_q`, { node: synth.filterCSNs.Q, type: 'number' });

        const awpNode = synth.fmSynth!.getAWPNode();
        return new Array(PARAM_BUFFER_COUNT).fill(null as any).reduce(
          (acc, _, i) =>
            acc.set(`synth_${voiceIx}_fm_input_${i}`, {
              type: 'number',
              node: awpNode
                ? (awpNode.parameters as Map<string, AudioParam>).get(i.toString())
                : new DummyNode(),
            }),
          inputsForSynth
        );
      }, ImmMap<string, ConnectableInput>())
      .set('midi', { node: midiNode, type: 'midi' }),
    outputs: ImmMap<string, ConnectableOutput>().set('masterOutput', {
      node: spectrumNode,
      type: 'customAudio',
    }),
  };
};
