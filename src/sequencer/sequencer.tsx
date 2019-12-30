import React, { Suspense } from 'react';
import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import {
  buildSequencerReduxInfra,
  buildInitialState,
  SequencerReduxInfra,
  SequencerReduxState,
  VoiceTarget,
  PlayingStatus,
  SchedulerScheme,
} from './redux';
import {
  create_empty_audio_connectables,
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
} from 'src/patchNetwork';
import Loading from 'src/misc/Loading';
import { UnimplementedError, UnreachableException } from 'ameo-utils';
import { buildMIDINode, MIDINode } from 'src/patchNetwork/midiNode';
import { initScheduler } from 'src/sequencer/scheduler';

const ctx = new AudioContext();

const SequencerUI = React.lazy(() => import('./SequencerUI'));

const reduxInfraMap: Map<string, SequencerReduxInfra> = new Map();

interface SerializedSequencer {
  voices: VoiceTarget[];
  sampleBank: unknown[];
  marks: boolean[][];
  bpm: number;
  playingStatus: PlayingStatus;
  midiOutputCount: number;
  gateOutputCount: number;
  schedulerScheme: SchedulerScheme;
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

  const {
    voices,
    marks,
    bpm,
    playingStatus,
    midiOutputs,
    gateOutputs,
    schedulerScheme,
  } = reduxInfra.getState().sequencer;

  const serialized: SerializedSequencer = {
    voices,
    sampleBank: [], // TODO
    marks,
    bpm,
    playingStatus,
    midiOutputCount: midiOutputs.length,
    gateOutputCount: gateOutputs.length,
    schedulerScheme,
  };

  return JSON.stringify(serialized);
};

export const buildGateOutput = (): ConstantSourceNode => {
  const csn = new ConstantSourceNode(ctx);
  csn.offset.value = 0;
  csn.start();
  return csn;
};

const deserializeSequencer = (serialized: string): SequencerReduxState => {
  const {
    voices,
    sampleBank,
    marks,
    bpm,
    playingStatus,
    midiOutputCount,
    gateOutputCount,
    schedulerScheme,
  }: SerializedSequencer = JSON.parse(serialized);

  const state = {
    activeBeat: 0,
    voices,
    sampleBank: [], // TODO: pull values out of the global sample store once we have that set up
    marks,
    bpm,
    playingStatus,
    outputGainNode: new GainNode(ctx),
    midiOutputs: R.times(
      () =>
        buildMIDINode(() => {
          throw new UnreachableException('MIDI output of sequencer has no inputs');
        }),
      midiOutputCount
    ),
    gateOutputs: R.times(buildGateOutput, gateOutputCount),
    schedulerScheme,
    risingEdgeDetector: undefined,
  };

  // If the sequencer was playing when we saved, re-start it and set a new valid handle
  if (state.playingStatus.type === 'PLAYING') {
    const handle = initScheduler(state);
    state.playingStatus = { type: 'PLAYING', intervalHandle: handle };
  }

  return state;
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

const LazySequencerUI: React.FC<{ vcId: string } & Pick<
  SequencerReduxInfra,
  'dispatch' | 'actionCreators'
>> = props => (
  <Suspense fallback={<Loading />}>
    <SequencerUI {...props} />
  </Suspense>
);

const buildRisingEdgeDetector = async (onDetected: () => void) => {
  await ctx.audioWorklet.addModule('/RisingEdgeDetectorWorkletProcessor.js');
  const workletHandle = new AudioWorkletNode(
    ctx,
    'rising-edge-detector-audio-worklet-node-processor'
  );
  workletHandle.connect(ctx.destination);
  workletHandle.port.onmessage = onDetected;
  return workletHandle;
};

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

  // Asynchronously init the rising edge detector and set it into the state once it's initialized
  buildRisingEdgeDetector(() =>
    reduxInfra.dispatch(reduxInfra.actionCreators.sequencer.INCREMENT_BEAT())
  ).then(workletHandle =>
    reduxInfra.dispatch(reduxInfra.actionCreators.sequencer.SET_RISING_EDGE_DETECTOR(workletHandle))
  );

  mkContainerRenderHelper({
    Comp: LazySequencerUI,
    store: reduxInfra.store,
    getProps: () => ({
      vcId,
      actionCreators: reduxInfra.actionCreators,
      dispatch: reduxInfra.dispatch,
    }),
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

export const get_sequencer_audio_connectables = (vcId: string): AudioConnectables => {
  const reduxInfra = reduxInfraMap.get(vcId);
  if (!reduxInfra) {
    console.error(
      `No entry in redux infra map for sequencer with id ${vcId}; can't return connectables`
    );
    return create_empty_audio_connectables(vcId);
  }
  const reduxState = reduxInfra.getState();

  let outputs = ImmMap<string, ConnectableOutput>().set('output', {
    node: reduxInfra.getState().sequencer.outputGainNode,
    type: 'customAudio',
  });
  outputs = reduxState.sequencer.midiOutputs.reduce(
    (acc: ImmMap<string, ConnectableOutput>, node: MIDINode, i: number) =>
      acc.set(`midi_output_${i + 1}`, { node, type: 'number' }),
    outputs
  );

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs,
  };
};

const schedulerFnBySchedulerScheme: {
  [K in SchedulerScheme]: (bpm: number, startBeat: number, endBeat: number) => number[];
} = {
  [SchedulerScheme.Stable]: (bpm: number, startBeat: number, endBeat: number) =>
    R.range(startBeat, endBeat + 1).map(beat => beat * (bpm / 60)),
  [SchedulerScheme.Random]: (_bpm: number, _startBeat: number, _endBeat: number) => {
    throw new UnimplementedError();
  },
  [SchedulerScheme.Swung]: (_bpm: number, _startBeat: number, _endBeat: number) => {
    throw new UnimplementedError();
  },
};

export const getBeatTimings = (
  scheme: SchedulerScheme,
  bpm: number,
  startBeat: number,
  endBeat: number
): number[] => schedulerFnBySchedulerScheme[scheme](bpm, startBeat, endBeat);
