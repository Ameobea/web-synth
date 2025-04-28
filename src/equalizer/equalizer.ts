import type { AudioConnectables } from 'src/patchNetwork';
import { mkContainerHider, mkContainerUnhider } from 'src/reactUtils';
import EqualizerUI from 'src/equalizer/EqualizerUI/EqualizerUI.svelte';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
import { rwritable, type TransparentWritable } from 'src/util';
import { EqualizerFilterType } from 'src/equalizer/eqHelpers';
import {
  buildDefaultLineSpecrogramUIState,
  type LineSpectrogramUIState,
} from 'src/visualizations/LineSpectrogram/types';

export interface EqualizerBand {
  filterType: EqualizerFilterType;
  frequency: number;
  q: number;
  gain: number;
}

export interface EqualizerState {
  bands: EqualizerBand[];
  activeBandIx?: number;
  lineSpectrogramUIState: LineSpectrogramUIState;
}

const buildDefaultEqualizerState = (): EqualizerState => ({
  bands: [
    { filterType: EqualizerFilterType.Lowshelf, frequency: 60, q: 1, gain: 0 },
    { filterType: EqualizerFilterType.Peak, frequency: 400, q: 1, gain: 0 },
    { filterType: EqualizerFilterType.Peak, frequency: 1600, q: 1, gain: 0 },
    { filterType: EqualizerFilterType.Highshelf, frequency: 6400, q: 1, gain: 0 },
  ],
  activeBandIx: 0,
  lineSpectrogramUIState: {
    ...buildDefaultLineSpecrogramUIState(),
    // this doesn't match the actual range of the eq's y axis, but the magnitudes of individual buckets
    // are so small that they barely show up if it does match.
    rangeDb: [-80, -20],
  },
});

const EqualizerCtxById = new Map<
  string,
  { inst: EqualizerInstance; uiState: TransparentWritable<{ hidden: boolean }> }
>();

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
    'z-index: 2; width: 100%; height: calc(100vh - 34px); position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const serialized = localStorage.getItem(stateKey);
  const initialState: EqualizerState = serialized
    ? deserializeEqualizer(serialized)
    : buildDefaultEqualizerState();

  const ctx = new AudioContext();
  const uiState = rwritable({ hidden: false });
  const inst = new EqualizerInstance(ctx, vcId, initialState, uiState);
  EqualizerCtxById.set(vcId, { inst, uiState });

  mkSvelteContainerRenderHelper({
    Comp: EqualizerUI,
    getProps: () => ({ inst }),
  })(domId);
};

export const persist_equalizer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = EqualizerCtxById.get(vcId);
  if (!ctx) {
    throw new Error(`No equalizer ctx found for vcId ${vcId}`);
  }
  const serialized = ctx.inst.serialize();
  localStorage.setItem(stateKey, JSON.stringify(serialized));
};

export const cleanup_equalizer = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = EqualizerCtxById.get(vcId);
  if (!ctx) {
    throw new Error(`No equalizer ctx found for vcId ${vcId}`);
  }
  const serialized = ctx.inst.serialize();
  localStorage.setItem(stateKey, JSON.stringify(serialized));

  ctx.inst.shutdown();

  mkSvelteContainerCleanupHelper()(getEqualizerDOMElementId(vcId));
};

export const get_equalizer_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1]!;
  const ctx = EqualizerCtxById.get(vcId);
  if (!ctx) {
    throw new Error(`No equalizer ctx found for vcId ${vcId}`);
  }

  return ctx.inst.buildAudioConnectables();
};

export const hide_equalizer = (stateKey: string) => {
  mkContainerHider(getEqualizerDOMElementId)(stateKey);

  const vcId = stateKey.split('_')[1]!;
  const ctx = EqualizerCtxById.get(vcId);
  if (!ctx) {
    throw new Error(`No equalizer ctx found for vcId ${vcId}`);
  }

  ctx.uiState.update(state => ({ ...state, hidden: true }));
};

export const unhide_equalizer = (stateKey: string) => {
  mkContainerUnhider(getEqualizerDOMElementId)(stateKey);

  const vcId = stateKey.split('_')[1]!;
  const ctx = EqualizerCtxById.get(vcId);
  if (!ctx) {
    throw new Error(`No equalizer ctx found for vcId ${vcId}`);
  }

  ctx.uiState.update(state => ({ ...state, hidden: false }));
};
