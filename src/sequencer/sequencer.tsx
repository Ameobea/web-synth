import React, { Suspense } from 'react';
import { Map as ImmMap } from 'immutable';

import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import {
  buildSequencerReduxInfra,
  buildInitialState,
  SequencerReduxInfra,
  SequencerReduxState,
  VoiceTarget,
  PlayingStatus,
} from './redux';
import {
  create_empty_audio_connectables,
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
} from 'src/patchNetwork';
import Loading from 'src/misc/Loading';

const ctx = new AudioContext();

const SequencerUI = React.lazy(() => import('./SequencerUI'));

const reduxInfraMap: Map<string, SequencerReduxInfra> = new Map();

interface SerializedSequencer {
  voices: VoiceTarget[];
  sampleBank: unknown[];
  marks: boolean[][];
  bpm: number;
  playingStatus: PlayingStatus;
}

const getSequencerDOMElementId = (vcId: string) => `sequencer-${vcId}`;

const serializeSequencer = (vcId: string): string => {
  const reduxInfra = reduxInfraMap.get(vcId);
  if (!reduxInfra) {
    console.error(
      `Missing entry in sequencer redux infra map for vcId ${vcId} when trying to serialize`
    );
    return '';
  }

  const { voices, marks, bpm, playingStatus } = reduxInfra.getState().sequencer;

  const serialized: SerializedSequencer = {
    voices,
    sampleBank: [], // TODO
    marks,
    bpm,
    playingStatus,
  };

  return JSON.stringify(serialized);
};

const deserializeSequencer = (serialized: string): SequencerReduxState => {
  const {
    voices,
    sampleBank: _sampleBank,
    marks,
    bpm,
    playingStatus,
  }: SerializedSequencer = JSON.parse(serialized);

  // TODO: Start it if it's playing?

  return {
    voices,
    sampleBank: [], // TODO: pull values out of the global sample store once we have that set up
    marks,
    bpm,
    playingStatus,
    outputGainNode: new GainNode(ctx),
  };
};

const loadInitialState = (stateKey: string, vcId: string) => {
  const serializedState = localStorage.getItem(stateKey);
  if (!serializedState) {
    return buildInitialState();
  }

  try {
    return deserializeSequencer(serializedState);
  } catch (_err) {
    console.error(
      `Failed to parse serialized state for sequencer id ${vcId}; building default state.`
    );
    return buildInitialState();
  }
};

const LazySequencerUI: React.FC<Pick<
  SequencerReduxInfra,
  'dispatch' | 'actionCreators'
>> = props => (
  <Suspense fallback={<Loading />}>
    <SequencerUI {...props} />
  </Suspense>
);

export const init_sequencer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const domId = getSequencerDOMElementId(vcId);
  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const initialState = loadInitialState(stateKey, vcId);

  const reduxInfra = buildSequencerReduxInfra(initialState);
  if (!!reduxInfraMap.get(vcId)) {
    console.error(`Existing entry in sequencer redux infra map for vcId ${vcId}; overwriting...`);
  }
  reduxInfraMap.set(vcId, reduxInfra);

  mkContainerRenderHelper({
    Comp: LazySequencerUI,
    store: reduxInfra.store,
    getProps: () => ({ actionCreators: reduxInfra.actionCreators, dispatch: reduxInfra.dispatch }),
  })(domId);
};

export const cleanup_sequencer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const serialized = serializeSequencer(vcId);
  localStorage.setItem(stateKey, serialized);

  mkContainerCleanupHelper()(getSequencerDOMElementId(vcId));
};

export const hide_sequencer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const elem = document.getElementById(getSequencerDOMElementId(vcId));
  if (!elem) {
    console.error(`Unable to find DOM element for sequencer with vcId ${vcId}; can't hide.`);
    return;
  }

  elem.style.display = 'none';
};

export const unhide_sequencer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const elem = document.getElementById(getSequencerDOMElementId(vcId));
  if (!elem) {
    console.error(`Unable to find DOM element for sequencer with vcId ${vcId}; can't unhide.`);
    return;
  }

  elem.style.display = 'block';
};

export const get_sequencer_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1]!;

  const reduxInfra = reduxInfraMap.get(vcId);
  if (!reduxInfra) {
    console.error(
      `No entry in redux infra map for sequencer with id ${vcId}; can't return connectables`
    );
    return create_empty_audio_connectables(vcId);
  }

  // TODO
  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs: ImmMap<string, ConnectableOutput>().set('output', {
      node: reduxInfra.getState().sequencer.outputGainNode,
      type: 'customAudio',
    }),
  };
};
