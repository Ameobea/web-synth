import { Map as ImmMap } from 'immutable';

import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import EqualizerUI from 'src/equalizer/EqualizerUI/EqualizerUI.svelte';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { EqualizerInstance } from 'src/equalizer/EqualizerInstance';

export enum EqualizerFilterType {
  Lowpass = 0,
  Highpass = 1,
  Bandpass = 2,
  Notch = 3,
  Peak = 4,
  Lowshelf = 5,
  Highshelf = 6,
  Allpass = 7,
  // TODO: Bell
}

export interface EqualizerBand {
  filterType: EqualizerFilterType;
  frequency: number;
  q: number;
  gain: number;
}

export interface EqualizerState {
  bands: EqualizerBand[];
}

const buildDefaultEqualizerState = (): EqualizerState => ({
  bands: [
    { filterType: EqualizerFilterType.Lowshelf, frequency: 100, q: 1, gain: 0 },
    { filterType: EqualizerFilterType.Highshelf, frequency: 10000, q: 1, gain: 0 },
  ],
});

const EqualizerInstancesById = new Map<string, EqualizerInstance>();

const getEqualizerDOMElementId = (vcId: string) => `equalizer-${vcId}`;

const deserializeEqualizer = (serialized: string): EqualizerState => {
  try {
    return JSON.parse(serialized);
  } catch (err) {
    console.warn('Error deserializing equalizer state: ', err);
    return buildDefaultEqualizerState();
  }
};

export const init_equalizer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const domId = getEqualizerDOMElementId(vcId);

  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const serialized = localStorage.getItem(stateKey);
  const initialState: EqualizerState = serialized
    ? deserializeEqualizer(serialized)
    : buildDefaultEqualizerState();

  const ctx = new AudioContext();
  const inst = new EqualizerInstance(ctx, vcId, initialState);
  EqualizerInstancesById.set(vcId, inst);

  mkSvelteContainerRenderHelper({
    Comp: EqualizerUI,
    getProps: () => ({ inst }),
  })(domId);
};

export const persist_equalizer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const inst = EqualizerInstancesById.get(vcId);
  if (!inst) {
    throw new Error(`No equalizer instance found for vcId ${vcId}`);
  }
  const serialized = inst.serialize();
  localStorage.setItem(stateKey, JSON.stringify(serialized));
};

export const cleanup_equalizer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const inst = EqualizerInstancesById.get(vcId);
  if (!inst) {
    throw new Error(`No equalizer instance found for vcId ${vcId}`);
  }
  const serialized = inst.serialize();
  localStorage.setItem(stateKey, JSON.stringify(serialized));

  inst.shutdown();

  mkSvelteContainerCleanupHelper()(getEqualizerDOMElementId(vcId));
};

export const get_equalizer_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1]!;
  const inst = EqualizerInstancesById.get(vcId);
  if (!inst) {
    throw new Error(`No equalizer instance found for vcId ${vcId}`);
  }

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('input', {
      type: 'customAudio',
      node: inst.awpHandle,
    }),
    outputs: ImmMap<string, ConnectableOutput>().set('output', {
      type: 'customAudio',
      node: inst.awpHandle,
    }),
  };
};

export const hide_equalizer = mkContainerHider(getEqualizerDOMElementId);
export const unhide_equalizer = mkContainerUnhider(getEqualizerDOMElementId);
