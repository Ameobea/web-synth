import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import type { SampleDescriptor } from 'src/sampleLibrary';
import SamplerUI from 'src/sampler/SamplerUI/SamplerUI.svelte';
import { mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { Map as ImmMap } from 'immutable';
import { SamplerInstance } from 'src/sampler/SamplerInstance';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { WaveformBounds } from 'src/granulator/GranulatorUI/WaveformRenderer';

export interface SamplerSelection {
  name?: string;
  startSampleIx: number | null;
  endSampleIx: number | null;
  startCrossfadeLenSamples: number;
  endCrossfadeLenSamples: number;
  /**
   * The bounds of the waveform in the UI.  Used for display only.
   */
  bounds?: WaveformBounds;
  midiNumber?: number;
  playbackRate: number;
  reverse?: boolean;
}

export const buildDefaultSamplerSelection = (): SamplerSelection => ({
  name: undefined,
  startSampleIx: null,
  endSampleIx: null,
  startCrossfadeLenSamples: 0,
  endCrossfadeLenSamples: 0,
  playbackRate: 1,
  reverse: false,
});

export interface SerializedSampler {
  activeSample: SampleDescriptor | null;
  selections: SamplerSelection[];
  activeSelectionIx: number | null;
}

const buildDefaultSamplerState = (): SerializedSampler => ({
  activeSample: null,
  selections: [],
  activeSelectionIx: null,
});

const SamplerInstancesById = new Map<string, SamplerInstance>();
const ActiveSamplerSamplesByVcId: Map<string, SampleDescriptor[]> = new Map();

const getSamplerDOMElementId = (vcId: string) => `sampler-${vcId}`;

const deserializeSampler = (serialized: string): SerializedSampler => {
  try {
    return JSON.parse(serialized);
  } catch (err) {
    console.warn('Error deserializing sampler state: ', err);
    return buildDefaultSamplerState();
  }
};

export const init_sampler = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const domId = getSamplerDOMElementId(vcId);
  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const serialized = localStorage.getItem(stateKey);
  const initialState: SerializedSampler = serialized
    ? deserializeSampler(serialized)
    : buildDefaultSamplerState();

  const inst = new SamplerInstance(vcId, initialState);
  SamplerInstancesById.set(vcId, inst);

  mkSvelteContainerRenderHelper({
    Comp: SamplerUI,
    getProps: () => ({ inst }),
  })(domId);
};

export const cleanup_sampler = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const inst = SamplerInstancesById.get(vcId);
  if (!inst) {
    throw new Error(`No sampler instance found for vcId ${vcId}`);
  }
  const serialized = inst.serialize();
  localStorage.setItem(stateKey, JSON.stringify(serialized));

  inst.shutdown();

  mkContainerCleanupHelper()(getSamplerDOMElementId(vcId));
};

export const get_sampler_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1]!;
  const inst = SamplerInstancesById.get(vcId);
  if (!inst) {
    throw new Error(`No sampler instance found for vcId ${vcId}`);
  }

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('input', {
      type: 'midi',
      node: inst.midiNode,
    }),
    outputs: ImmMap<string, ConnectableOutput>().set('output', {
      type: 'customAudio',
      node: inst.awpHandle ?? new DummyNode(),
    }),
  };
};

export const hide_sampler = mkContainerHider(getSamplerDOMElementId);

export const unhide_sampler = mkContainerUnhider(getSamplerDOMElementId);

export const sampler_list_used_samples = (vcId: string): SampleDescriptor[] =>
  ActiveSamplerSamplesByVcId.get(vcId) ?? [];
