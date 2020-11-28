import React, { Suspense } from 'react';
import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';
import { filterNils, UnreachableException } from 'ameo-utils';

import {
  mkContainerRenderHelper,
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerUnhider,
} from 'src/reactUtils';
import {
  AudioConnectables,
  ConnectableInput,
  ConnectableOutput,
  updateConnectables,
} from 'src/patchNetwork';
import Loading from 'src/misc/Loading';
import { buildMIDINode, MIDINode } from 'src/patchNetwork/midiNode';
import { SampleDescriptor, getSample } from 'src/sampleLibrary';
import {
  buildSequencerReduxInfra,
  buildInitialState,
  SequencerReduxState,
  VoiceTarget,
  SchedulerScheme,
  buildSequencerConfig,
  SequencerMark,
  SequencerReduxInfraMap,
  buildSequencerInputMIDINode,
  SequencerEditState,
} from './redux';
import { SequencerSmallView, SequencerUIProps } from 'src/sequencer/SequencerUI/SequencerUI';
import { AsyncOnce } from 'src/util';
import { SequencerBeatPlayerByVoiceType } from 'src/sequencer/scheduler';

const ctx = new AudioContext();

const SequencerUI = React.lazy(() => import('./SequencerUI'));

interface SerializedSequencer {
  currentEditingVoiceIx: number;
  voices: VoiceTarget[];
  sampleBank: { [voiceIx: number]: SampleDescriptor | null };
  marks: (SequencerMark | null)[][];
  bpm: number;
  isPlaying: boolean;
  midiOutputCount: number;
  gateOutputCount: number;
  schedulerScheme: SchedulerScheme;
  markEditState?: SequencerEditState | null;
}

const getSequencerDOMElementId = (vcId: string) => `sequencer-${vcId}`;

const serializeSequencer = (vcId: string): string => {
  const reduxInfra = SequencerReduxInfraMap.get(vcId);
  if (!reduxInfra) {
    console.error(
      `Missing entry in sequencer redux infra map for vcId ${vcId} when trying to serialize`
    );
    return '';
  }

  const {
    currentEditingVoiceIx,
    voices,
    marks,
    bpm,
    isPlaying,
    midiOutputs,
    gateOutputs,
    schedulerScheme,
    sampleBank,
    markEditState,
  } = reduxInfra.getState().sequencer;

  const serialized: SerializedSequencer = {
    currentEditingVoiceIx,
    voices,
    sampleBank: Object.values(sampleBank).map(item => (item ? item.descriptor : item)),
    marks,
    bpm,
    isPlaying,
    midiOutputCount: midiOutputs.length,
    gateOutputCount: gateOutputs.length,
    schedulerScheme,
    markEditState,
  };

  return JSON.stringify(serialized);
};

export const buildGateOutput = (): ConstantSourceNode => {
  const csn = new ConstantSourceNode(ctx);
  csn.offset.value = 0;
  csn.start();
  return csn;
};

const SequencerAWPRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule('/SequencerWorkletProcessor.js')
);
const initSequenceAWP = async (vcId: string): Promise<AudioWorkletNode> => {
  await SequencerAWPRegistered.get();
  const workletHandle = new AudioWorkletNode(ctx, 'sequencer-audio-worklet-node-processor');

  workletHandle.port.onmessage = msg => {
    switch (msg.data.type) {
      case 'triggerVoice': {
        const state = SequencerReduxInfraMap.get(vcId)!.getState().sequencer;
        const { voiceIx, markIx } = msg.data;

        SequencerBeatPlayerByVoiceType[state.voices[voiceIx].type](
          state,
          voiceIx,
          state.voices[voiceIx] as any,
          state.marks[voiceIx][markIx]! as any
        );
        break;
      }
      default: {
        console.warn(`Unhandled message type received from sequencer AWP: ${msg.data.type}`);
      }
    }
  };
  const state = SequencerReduxInfraMap.get(vcId)!.getState().sequencer;
  workletHandle.port.postMessage({ type: 'configure', config: buildSequencerConfig(state) });

  return workletHandle;
};

const initSampleBank = async (sampleBank: { [voiceIx: number]: SampleDescriptor | null }) =>
  (
    await Promise.all(
      Object.entries(sampleBank).map(async ([voiceIx, descriptor]) => {
        if (!descriptor) {
          return [+voiceIx, null] as const;
        }

        try {
          const buffer = await getSample(descriptor);
          return [+voiceIx, { descriptor, buffer }] as const;
        } catch (err) {
          console.warn(`Unable to load sample named "${descriptor.name}": `, err);
          // Unable to load the referenced sample for whatever reason
          return [+voiceIx, null] as const;
        }
      })
    )
  ).reduce(
    (acc, [voiceIx, val]) => acc.then(acc => ({ ...acc, [voiceIx]: val })),
    Promise.resolve({}) as Promise<{
      [voiceIx: number]: { descriptor: SampleDescriptor; buffer: AudioBuffer } | null;
    }>
  );

const deserializeSequencer = (serialized: string, vcId: string): SequencerReduxState => {
  const {
    currentEditingVoiceIx,
    voices,
    sampleBank,
    marks,
    bpm,
    isPlaying,
    midiOutputCount,
    gateOutputCount,
    schedulerScheme,
    markEditState,
  }: SerializedSequencer = JSON.parse(serialized);

  initSampleBank(sampleBank).then(sampleBank => {
    const reduxInfra = SequencerReduxInfraMap.get(vcId);
    if (!reduxInfra) {
      console.warn('No redux infra found after loading samples');
      return;
    }
    reduxInfra.dispatch(reduxInfra.actionCreators.sequencer.SET_SAMPLES(sampleBank));
  });

  const state = {
    currentEditingVoiceIx,
    activeBeats: voices.map(() => 0),
    voices,
    sampleBank: 'LOADING' as const,
    marks,
    bpm,
    isPlaying: false, // This will be set asynchronously if auto-start enabled
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
    awpHandle: undefined,
    inputMIDINode: buildSequencerInputMIDINode(vcId),
    markEditState: markEditState || null,
  };

  initSequenceAWP(vcId).then(awpHandle => {
    const reduxInfra = SequencerReduxInfraMap.get(vcId);
    if (!reduxInfra) {
      console.warn('No redux infra found for sequencer when trying to auto-start');
      return;
    }
    reduxInfra.dispatch(reduxInfra.actionCreators.sequencer.SET_AWP_HANDLE(awpHandle));

    // If the sequencer was playing when we saved, re-start it and set a new valid handle
    if (isPlaying) {
      reduxInfra.dispatch(reduxInfra.actionCreators.sequencer.TOGGLE_IS_PLAYING());
    }
  });

  return state;
};

const loadInitialState = (stateKey: string, vcId: string) => {
  const serializedState = localStorage.getItem(stateKey);
  if (!serializedState) {
    return buildInitialState(vcId);
  }

  try {
    return deserializeSequencer(serializedState, vcId);
  } catch (_err) {
    console.error(
      `Failed to parse serialized state for sequencer id ${vcId}; building default state.`
    );
    return buildInitialState(vcId);
  }
};

const LazySequencerUI: React.FC<SequencerUIProps> = props => (
  <Suspense fallback={<Loading />}>
    <SequencerUI {...props} />
  </Suspense>
);

export const get_sequencer_audio_connectables = (vcId: string): AudioConnectables => {
  const reduxInfra = SequencerReduxInfraMap.get(vcId);

  if (!reduxInfra) {
    throw new UnreachableException(
      "Expected to find redux infra for sequencer when initializing, but didn't find it"
    );
  }
  const reduxState = reduxInfra.getState();

  let outputs = ImmMap<string, ConnectableOutput>().set('output', {
    node: reduxInfra.getState().sequencer.outputGainNode,
    type: 'customAudio',
  });
  outputs = reduxState.sequencer.midiOutputs.reduce(
    (acc: ImmMap<string, ConnectableOutput>, node: MIDINode, i: number) =>
      acc.set(`midi_output_${i + 1}`, { node, type: 'midi' }),
    outputs
  );

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('midi_input', {
      type: 'midi',
      node: reduxState.sequencer.inputMIDINode,
    }),
    outputs,
  };
};

export const init_sequencer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const domId = getSequencerDOMElementId(vcId);
  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const initialState = loadInitialState(stateKey, vcId);
  const reduxInfra = buildSequencerReduxInfra(initialState);
  if (!!SequencerReduxInfraMap.get(vcId)) {
    console.error(`Existing entry in sequencer redux infra map for vcId ${vcId}; overwriting...`);
  }
  SequencerReduxInfraMap.set(vcId, reduxInfra);

  // Since we asynchronously init, we need to update our connections manually once we've created a valid internal state
  updateConnectables(vcId, get_sequencer_audio_connectables(vcId));

  mkContainerRenderHelper({
    Comp: LazySequencerUI,
    store: reduxInfra.store,
    getProps: () => ({
      vcId,
      ...reduxInfra,
    }),
  })(domId);
};

export const cleanup_sequencer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  // Stop it if it is playing
  const reduxInfra = SequencerReduxInfraMap.get(vcId)!;
  if (!reduxInfra) {
    throw new Error(`No sequencer Redux infra map entry for sequencer with vcId ${vcId}`);
  }
  const serialized = serializeSequencer(vcId);
  if (reduxInfra.getState().sequencer.isPlaying) {
    reduxInfra.dispatch(reduxInfra.actionCreators.sequencer.TOGGLE_IS_PLAYING());
  }

  localStorage.setItem(stateKey, serialized);

  mkContainerCleanupHelper()(getSequencerDOMElementId(vcId));
};

export const hide_sequencer = mkContainerHider(getSequencerDOMElementId);

export const unhide_sequencer = mkContainerUnhider(getSequencerDOMElementId);

export const render_sequencer_small_view = (vcId: string, domId: string) => {
  const reduxInfra = SequencerReduxInfraMap.get(vcId);
  if (!reduxInfra) {
    throw new Error(`No redux infra for sequencer with vcId ${vcId} when rendering small view`);
  }

  mkContainerRenderHelper({
    Comp: SequencerSmallView,
    getProps: () => ({ ...reduxInfra }),
    store: reduxInfra.store,
  })(domId);
};

export const cleanup_sequencer_small_view = (_vcId: string, domId: string) =>
  mkContainerCleanupHelper()(domId);

export const sequencer_list_used_samples = (stateKey: string): SampleDescriptor[] => {
  const vcId = stateKey.split('_')[1]!;
  const reduxInfra = SequencerReduxInfraMap.get(vcId);
  if (!reduxInfra) {
    console.warn('No redux infra found for live sequencer with vcId=' + vcId);
    return [];
  }

  const state = reduxInfra.getState().sequencer;
  const { sampleBank } = state;
  if (typeof sampleBank === 'string') {
    console.warn('Tried to get list of used samples for sequencer before sample bank was loaded');

    const serializedState = localStorage.getItem(stateKey);
    if (!serializedState) {
      return [];
    }

    try {
      const { sampleBank }: SerializedSequencer = JSON.parse(serializedState);
      return filterNils(Object.values(sampleBank));
    } catch (_err) {
      console.error(
        `Failed to parse serialized state for sequencer id ${vcId} when getting used samples`
      );
      return [];
    }
    return [];
  }

  return filterNils(
    state.voices.map((voice, i) => (voice.type === 'sample' ? sampleBank[i]?.descriptor : null))
  );
};
