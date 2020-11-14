import React, { Suspense } from 'react';
import { Map as ImmMap } from 'immutable';

import {
  mkContainerRenderHelper,
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerUnhider,
} from 'src/reactUtils';
import { AudioConnectables, ConnectableInput, updateConnectables } from 'src/patchNetwork';
import Loading from 'src/misc/Loading';
import { store } from 'src/redux';

interface GranulatorState {}

const ctx = new AudioContext();

const GranulatorUI = React.lazy(() => import('./GranulatorUI'));

const getGranulatorDOMElementId = (vcId: string) => `sequencer-${vcId}`;

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
  // TODO
  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs: ImmMap(),
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

  // TODO

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

  mkContainerCleanupHelper()(getGranulatorDOMElementId(vcId));
};

export const hide_granulator = mkContainerHider(getGranulatorDOMElementId);

export const unhide_granulator = mkContainerUnhider(getGranulatorDOMElementId);
