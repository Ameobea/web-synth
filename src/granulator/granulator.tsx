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
import { GranulatorControlPanelState } from 'src/granulator/GranulatorUI';

interface GranulatorState {
  startSample: number;
  endSample: number;
  grainSize: number;
  grainSpeedRatio: number;
  sampleSpeedRatio: number;
  voice1FilterCutoff: number;
  voice2FilterCutoff: number;
}

const ctx = new AudioContext();

const GranulatorRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule('/GranulatorWorkletProcessor.js')
);

export const GranulatorInstancesById = new Map<
  string,
  {
    node: AudioWorkletNode;
    startSample: OverridableAudioParam;
    endSample: OverridableAudioParam;
    grainSize: OverridableAudioParam;
    grainSpeedRatio: OverridableAudioParam;
    sampleSpeedRatio: OverridableAudioParam;
    voice1FilterCutoff: OverridableAudioParam;
    voice2FilterCutoff: OverridableAudioParam;
  }
>();

const GranulatorUI = React.lazy(() => import('./GranulatorUI'));

const getGranulatorDOMElementId = (vcId: string) => `granulator-${vcId}`;

const serializeGranulator = (vcId: string): string => {
  return JSON.stringify({}); // TODO
};

const deserializeGranulator = async (serialized: string): Promise<GranulatorState> => {
  return {}; // TODO
};

const LazyGranulatorUI: React.FC<{
  vcId: string;
  initialState: GranulatorControlPanelState;
}> = props => (
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

const GranularWasm = new AsyncOnce(async () =>
  fetch('/granular.wasm').then(res => res.arrayBuffer())
);

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

  // TODO: Load from localStorage
  const initialState: GranulatorControlPanelState = {
    grain_size: 800.0,
    grain_speed_ratio: 1.0,
    sample_speed_ratio: 1.0,
    voice_1_filter_cutoff: 0.0,
    voice_2_filter_cutoff: 0.0,
  };

  const granularWasmPromise = GranularWasm.get();
  GranulatorRegistered.get().then(async () => {
    const node = new AudioWorkletNode(ctx, 'granulator-audio-worklet-processor');
    const granularWasm = await granularWasmPromise;
    // Once we've fetched the Wasm bytes for the granular's DSP instance, we send them to the AWP
    // to be instantiated and start.
    node.port.postMessage({ type: 'setWasmBytes', wasmBytes: granularWasm });

    const params = node.parameters as any;
    const inst = {
      node,
      startSample: new OverridableAudioParam(ctx, params.get('start_sample')),
      endSample: new OverridableAudioParam(ctx, params.get('end_sample')),
      grainSize: new OverridableAudioParam(ctx, params.get('grain_size')),
      grainSpeedRatio: new OverridableAudioParam(ctx, params.get('grain_speed_ratio')),
      sampleSpeedRatio: new OverridableAudioParam(ctx, params.get('sample_speed_ratio')),
      voice1FilterCutoff: new OverridableAudioParam(ctx, params.get('voice_1_filter_cutoff')),
      voice2FilterCutoff: new OverridableAudioParam(ctx, params.get('voice_2_filter_cutoff')),
    };
    inst.grainSize.manualControl.offset.value = initialState.grain_size;
    inst.grainSpeedRatio.manualControl.offset.value = initialState.grain_speed_ratio;
    inst.sampleSpeedRatio.manualControl.offset.value = initialState.sample_speed_ratio;
    GranulatorInstancesById.set(vcId, inst);
    updateConnectables(vcId, get_granulator_audio_connectables(vcId));
  });

  // Since we asynchronously init, we need to update our connections manually once we've created a valid internal state
  updateConnectables(vcId, get_granulator_audio_connectables(vcId));

  mkContainerRenderHelper({
    Comp: LazyGranulatorUI,
    store,
    getProps: () => ({ vcId, initialState }),
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
