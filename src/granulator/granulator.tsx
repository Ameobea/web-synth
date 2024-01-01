import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import React, { Suspense } from 'react';

import {
  ActiveSamplesByVcId,
  type GranulatorUIProps,
  type GranulatorControlPanelState,
} from 'src/granulator/GranulatorUI';
import { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import Loading from 'src/misc/Loading';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import type { SampleDescriptor } from 'src/sampleLibrary';
import { AsyncOnce } from 'src/util';
import { get, writable } from 'svelte/store';

const ctx = new AudioContext();

const GranulatorAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'GranulatorWorkletProcessor.js?cacheBust=' +
        btoa(Math.random().toString())
    ),
  true
);

export interface GranulatorInstance {
  node: AudioWorkletNode;
  startSample: OverridableAudioParam;
  endSample: OverridableAudioParam;
  grainSize: OverridableAudioParam;
  voice1SamplesBetweenGrains: OverridableAudioParam;
  voice2SamplesBetweenGrains: OverridableAudioParam;
  sampleSpeedRatio: OverridableAudioParam;
  voice1FilterCutoff: OverridableAudioParam;
  voice2FilterCutoff: OverridableAudioParam;
  linearSlopeLength: OverridableAudioParam;
  slopeLinearity: OverridableAudioParam;
  voice1MovementSamplesPerSample: OverridableAudioParam;
  voice2MovementSamplesPerSample: OverridableAudioParam;
  selectedSample: SampleDescriptor | null;
  waveformRenderer: WaveformRenderer;
}

export const GranulatorInstancesById = writable(ImmMap<string, GranulatorInstance>());

const GranulatorUI = React.lazy(() => import('./GranulatorUI'));

const getGranulatorDOMElementId = (vcId: string) => `granulator-${vcId}`;

interface SerializedGranulator {
  controlPanelState: GranulatorControlPanelState;
  selectedSample: SampleDescriptor | null;
  startSample: number | null;
  endSample: number | null;
}

const serializeGranulator = (vcId: string): string => {
  const inst = get(GranulatorInstancesById).get(vcId);
  if (!inst) {
    throw new Error(`No granulator instance with vcId=${vcId}`);
  }
  const controlPanelState: GranulatorControlPanelState = {
    grain_size: inst.grainSize.manualControl.offset.value,
    voice_1_samples_between_grains: inst.voice1SamplesBetweenGrains.manualControl.offset.value,
    voice_2_samples_between_grains: inst.voice2SamplesBetweenGrains.manualControl.offset.value,
    sample_speed_ratio: inst.sampleSpeedRatio.manualControl.offset.value,
    voice_1_filter_cutoff: inst.voice1FilterCutoff.manualControl.offset.value,
    voice_2_filter_cutoff: inst.voice2FilterCutoff.manualControl.offset.value,
    linear_slope_length: inst.linearSlopeLength.manualControl.offset.value,
    slope_linearity: inst.slopeLinearity.manualControl.offset.value,
    voice_1_movement_samples_per_sample:
      inst.voice1MovementSamplesPerSample.manualControl.offset.value,
    voice_2_movement_samples_per_sample:
      inst.voice2MovementSamplesPerSample.manualControl.offset.value,
  };
  const serialized: SerializedGranulator = {
    controlPanelState,
    selectedSample: inst.selectedSample,
    startSample: inst.startSample.manualControl.offset.value,
    endSample: inst.endSample.manualControl.offset.value,
  };

  return JSON.stringify(serialized);
};

const buildDefaultGranulatorState = (): SerializedGranulator => ({
  controlPanelState: {
    grain_size: 800.0,
    voice_1_samples_between_grains: 800.0,
    voice_2_samples_between_grains: 800.0,
    sample_speed_ratio: 1.0,
    voice_1_filter_cutoff: 0.0,
    voice_2_filter_cutoff: 0.0,
    linear_slope_length: 0.3,
    slope_linearity: 0.6,
    voice_1_movement_samples_per_sample: 1,
    voice_2_movement_samples_per_sample: 1,
  },
  selectedSample: null,
  startSample: null,
  endSample: null,
});

const deserializeGranulator = (serialized: string): SerializedGranulator => {
  try {
    const deserialized = JSON.parse(serialized);
    if (!deserialized.controlPanelState) {
      throw new Error();
    }
    return deserialized;
  } catch (err) {
    console.warn('Error deserializing granulator state: ', err);
    return buildDefaultGranulatorState();
  }
};

const LazyGranulatorUI: React.FC<GranulatorUIProps> = props => (
  <Suspense fallback={<Loading />}>
    <GranulatorUI {...props} />
  </Suspense>
);

export const build_granulator_audio_connectables = (vcId: string): AudioConnectables => {
  const inst = get(GranulatorInstancesById).get(vcId);
  if (!inst) {
    return {
      vcId,
      inputs: ImmMap<string, ConnectableInput>()
        .set('start_sample', { type: 'number', node: new DummyNode() })
        .set('end sample', { type: 'number', node: new DummyNode() })
        .set('filter cutoff', { type: 'number', node: new DummyNode() })
        .set('sample speed ratio', { type: 'number', node: new DummyNode() })
        .set('playhead movement speed ratio', { type: 'number', node: new DummyNode() })
        .set('recording_input', { type: 'customAudio', node: new DummyNode() }),
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
      .set('end sample', { type: 'number', node: inst.endSample })
      .set('filter cutoff', { type: 'number', node: inst.voice1FilterCutoff })
      .set('sample speed ratio', { type: 'number', node: inst.sampleSpeedRatio })
      .set('playhead movement speed ratio', {
        type: 'number',
        node: inst.voice1MovementSamplesPerSample,
      })
      .set('recording_input', { type: 'customAudio', node: inst.node }),
    outputs: ImmMap<string, ConnectableOutput>().set('output', {
      type: 'customAudio',
      node: inst.node,
    }),
  };
};

const GranularWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'granular.wasm?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : genRandomStringID())
    ).then(res => res.arrayBuffer()),
  true
);

export const init_granulator = async (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const domId = getGranulatorDOMElementId(vcId);
  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const serialized = localStorage.getItem(stateKey);
  const initialState: SerializedGranulator = Option.of(serialized)
    .map(deserializeGranulator)
    .getOrElseL(buildDefaultGranulatorState);

  const granularWasmPromise = GranularWasm.get();
  const waveformRenderer = new WaveformRenderer();
  GranulatorAWPRegistered.get().then(async () => {
    const node = new AudioWorkletNode(ctx, 'granulator-audio-worklet-processor', {
      channelCount: 1,
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    const granularWasm = await granularWasmPromise;
    // Once we've fetched the Wasm bytes for the granular's DSP instance, we send them to the AWP
    // to be instantiated and start.
    node.port.postMessage({ type: 'setWasmBytes', wasmBytes: granularWasm });

    const params = node.parameters as any;
    const inst: GranulatorInstance = {
      node,
      startSample: new OverridableAudioParam(ctx, params.get('start_sample')),
      endSample: new OverridableAudioParam(ctx, params.get('end_sample')),
      grainSize: new OverridableAudioParam(ctx, params.get('grain_size')),
      voice1SamplesBetweenGrains: new OverridableAudioParam(
        ctx,
        params.get('voice_1_samples_between_grains')
      ),
      voice2SamplesBetweenGrains: new OverridableAudioParam(
        ctx,
        params.get('voice_2_samples_between_grains')
      ),
      sampleSpeedRatio: new OverridableAudioParam(ctx, params.get('sample_speed_ratio')),
      voice1FilterCutoff: new OverridableAudioParam(ctx, params.get('voice_1_filter_cutoff')),
      voice2FilterCutoff: new OverridableAudioParam(ctx, params.get('voice_2_filter_cutoff')),
      linearSlopeLength: new OverridableAudioParam(ctx, params.get('linear_slope_length')),
      slopeLinearity: new OverridableAudioParam(ctx, params.get('slope_linearity')),
      voice1MovementSamplesPerSample: new OverridableAudioParam(
        ctx,
        params.get('voice_1_movement_samples_per_sample')
      ),
      voice2MovementSamplesPerSample: new OverridableAudioParam(
        ctx,
        params.get('voice_2_movement_samples_per_sample')
      ),
      selectedSample: initialState.selectedSample,
      waveformRenderer,
    };
    if (initialState.startSample !== null) {
      inst.startSample.manualControl.offset.value = initialState.startSample;
    } else {
      inst.startSample.manualControl.offset.value = -1;
    }
    if (initialState.endSample !== null) {
      inst.endSample.manualControl.offset.value = initialState.endSample;
    } else {
      inst.endSample.manualControl.offset.value = -1;
    }
    GranulatorInstancesById.update(map => map.set(vcId, inst));
    updateConnectables(vcId, build_granulator_audio_connectables(vcId));
  });

  // Since we asynchronously init, we need to update our connections manually once we've created a valid internal state
  updateConnectables(vcId, build_granulator_audio_connectables(vcId));

  mkContainerRenderHelper({
    Comp: LazyGranulatorUI,
    getProps: (): GranulatorUIProps => ({
      vcId,
      initialState: initialState.controlPanelState,
      selectedSample: initialState.selectedSample,
      waveformRenderer,
    }),
  })(domId);
};

export const cleanup_granulator = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const serialized = serializeGranulator(vcId);
  localStorage.setItem(stateKey, serialized);

  const inst = get(GranulatorInstancesById).get(vcId);
  if (inst) {
    inst.node.port.postMessage({ type: 'shutdown' });
    inst.startSample.dispose();
    inst.endSample.dispose();
  }

  mkContainerCleanupHelper()(getGranulatorDOMElementId(vcId));
};

export const hide_granulator = mkContainerHider(getGranulatorDOMElementId);

export const unhide_granulator = mkContainerUnhider(getGranulatorDOMElementId);

export const granulator_list_used_samples = (vcId: string): SampleDescriptor[] =>
  ActiveSamplesByVcId.get(vcId) ?? [];
