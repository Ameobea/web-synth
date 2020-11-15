import React, { Suspense } from 'react';
import { Map as ImmMap } from 'immutable';

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
import { store } from 'src/redux';
import { AsyncOnce } from 'src/util';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

interface GranulatorState {}

const ctx = new AudioContext();

const GranulatorRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule('/GranulatorWorkletProcessor.js')
);

export const GranulatorInstancesById = new Map<
  string,
  { node: AudioWorkletNode; startSample: OverridableAudioParam; endSample: OverridableAudioParam }
>();

const GranulatorUI = React.lazy(() => import('./GranulatorUI'));

const getGranulatorDOMElementId = (vcId: string) => `granulator-${vcId}`;

const serializeGranulator = (vcId: string): string => {
  return JSON.stringify({}); // TODO
};

const deserializeGranulator = async (serialized: string): Promise<GranulatorState> => {
  return {}; // TODO
};

const LazyGranulatorUI: React.FC<{ vcId: string }> = props => (
  <Suspense fallback={<Loading />}>
    <GranulatorUI {...props} />
  </Suspense>
);

export const get_granulator_audio_connectables = (vcId: string): AudioConnectables => {
  const inst = GranulatorInstancesById.get(vcId);
  if (!inst) {
    return {
      vcId,
      inputs: ImmMap<string, ConnectableInput>()
        .set('start_sample', { type: 'number', node: new DummyNode() })
        .set('end sample', { type: 'number', node: new DummyNode() }),
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        type: 'customAudio',
        node: new DummyNode(),
      }),
    };
  }

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>()
      .set('start_sample', { type: 'number', node: inst.startSample })
      .set('end sample', { type: 'number', node: inst.endSample }),
    outputs: ImmMap<string, ConnectableOutput>().set('output', {
      type: 'customAudio',
      node: inst.node,
    }),
  };
};

export const init_granulator = async (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const domId = getGranulatorDOMElementId(vcId);
  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  GranulatorRegistered.get().then(() => {
    const node = new AudioWorkletNode(ctx, 'granulator-audio-worklet-processor');
    const startSample = new OverridableAudioParam(
      ctx,
      (node.parameters as any).get('start_sample')
    );
    const endSample = new OverridableAudioParam(ctx, (node.parameters as any).get('end_sample'));

    GranulatorInstancesById.set(vcId, { node, startSample, endSample });
    updateConnectables(vcId, get_granulator_audio_connectables(vcId));
  });

  // Since we asynchronously init, we need to update our connections manually once we've created a valid internal state
  updateConnectables(vcId, get_granulator_audio_connectables(vcId));

  mkContainerRenderHelper({
    Comp: LazyGranulatorUI,
    store,
    getProps: () => ({ vcId }),
  })(domId);
};

export const cleanup_granulator = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const serialized = serializeGranulator(vcId);
  localStorage.setItem(stateKey, serialized);

  const inst = GranulatorInstancesById.get(vcId);
  if (inst) {
    inst.node.port.postMessage({ type: 'shutdown' });
    inst.startSample.dispose();
    inst.endSample.dispose();
  }

  mkContainerCleanupHelper()(getGranulatorDOMElementId(vcId));
};

export const hide_granulator = mkContainerHider(getGranulatorDOMElementId);

export const unhide_granulator = mkContainerUnhider(getGranulatorDOMElementId);
