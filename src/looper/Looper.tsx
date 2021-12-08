import React, { Suspense } from 'react';
import { UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';

import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { LooperUIProps } from 'src/looper/LooperUI/LooperUI';
import {
  buildDefaultLooperInstState,
  looperActions,
  LooperInstState,
  SerializedLooperInstState,
} from 'src/redux/modules/looper';
import { getState, looperDispatch, store } from 'src/redux';
import { LooperNode } from 'src/looper/LooperNode';

const LazyLooperUI = React.lazy(() => import('src/looper/LooperUI/LooperUI'));

const LooperUI: React.FC<LooperUIProps> = props => (
  <Suspense fallback={<>Loading...</>}>
    <LazyLooperUI {...props} />
  </Suspense>
);

interface LooperCtx {
  looperNode: LooperNode;
}

const deserializeLooper = (serialized: string): Omit<LooperInstState, 'looperNode'> => {
  const parsed: SerializedLooperInstState = JSON.parse(serialized);
  return { ...parsed, phaseSAB: null, isHidden: true };
};

const serializeLooper = (looperState: LooperInstState): string => {
  const serialized: SerializedLooperInstState = { ...looperState };
  return JSON.stringify(serialized);
};

const getLooperDOMElementId = (vcId: string) => `looper_${vcId}`;

const LooperCtxsByVcId: Map<string, LooperCtx> = new Map();

export const init_looper = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const domId = getLooperDOMElementId(vcId);
  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const serialized = localStorage.getItem(stateKey);
  const initialState: Omit<LooperInstState, 'looperNode'> = Option.of(serialized)
    .map(s => {
      try {
        return deserializeLooper(s);
      } catch (err) {
        console.warn('Error deserializing looper state', err);
        return buildDefaultLooperInstState();
      }
    })
    .getOrElseL(buildDefaultLooperInstState);

  const onPhaseSABReceived = (phaseSAB: Float32Array) =>
    looperDispatch(looperActions.setPhaseSAB({ vcId, phaseSAB }));
  const looperNode = new LooperNode(vcId, initialState, onPhaseSABReceived);

  const ctx: LooperCtx = { looperNode };
  LooperCtxsByVcId.set(vcId, ctx);

  looperDispatch(
    looperActions.setLooperInstState({ vcId, state: { ...initialState, looperNode } })
  );

  mkContainerRenderHelper({
    Comp: LooperUI,
    getProps: () => ({ vcId }),
    store,
  })(domId);
};

export const cleanup_looper = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const ctx = LooperCtxsByVcId.get(vcId);
  if (!ctx) {
    console.warn('Missing looper ctx for vcId=' + vcId);
  } else {
    const looperInstState = getState().looper.stateByVcId[vcId];
    if (!looperInstState) {
      console.error('Missing looper state for vcId=' + vcId);
    } else {
      const serialized = serializeLooper(looperInstState);
      localStorage.setItem(stateKey, serialized);
    }

    LooperCtxsByVcId.delete(vcId);
  }

  mkContainerCleanupHelper()(getLooperDOMElementId(vcId));
};

export const hide_looper = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  looperDispatch(looperActions.setIsHidden({ vcId, isHidden: true }));
  mkContainerHider(getLooperDOMElementId)(stateKey);
};

export const unhide_looper = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  looperDispatch(looperActions.setIsHidden({ vcId, isHidden: false }));
  mkContainerUnhider(getLooperDOMElementId)(stateKey);
};

export const get_looper_audio_connectables = (vcId: string): AudioConnectables => {
  const ctx = LooperCtxsByVcId.get(vcId);
  if (!ctx) {
    throw new UnreachableException('Missing state for looper vcId=' + vcId);
  }

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs: ctx.looperNode.midiNodes.reduce((acc, midiNode, moduleIx) => {
      const moduleName = getState().looper.stateByVcId[vcId].modules[moduleIx].name;
      return acc.set(moduleName, { type: 'midi', node: midiNode });
    }, ImmMap<string, ConnectableOutput>()),
  };
};