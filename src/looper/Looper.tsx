import { Option } from 'funfix-core';
import React, { Suspense } from 'react';

import { LooperNode } from 'src/looper/LooperNode';
import { LooperCtxsByVcId, type LooperCtx } from 'src/looper/looperCtx';
import type { LooperUIProps } from 'src/looper/LooperUI/LooperUI';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import { getState, looperDispatch, store } from 'src/redux';
import {
  buildDefaultLooperInstState,
  deserializeLooper,
  looperActions,
  serializeLooper,
  type LooperInstState,
} from 'src/redux/modules/looper';

export { get_looper_audio_connectables } from 'src/looper/looperCtx';

const LazyLooperUI = React.lazy(() => import('src/looper/LooperUI/LooperUI'));

const LooperUI: React.FC<LooperUIProps> = props => (
  <Suspense fallback={<>Loading...</>}>
    <LazyLooperUI {...props} />
  </Suspense>
);

const getLooperDOMElementId = (vcId: string) => `looper_${vcId}`;

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

  if ((window as any).isHeadless) {
    return;
  }

  mkContainerRenderHelper({
    Comp: LooperUI,
    getProps: () => ({ vcId }),
    store,
  })(domId);
};

export const persist_looper = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;
  const looperInstState = getState().looper.stateByVcId[vcId];
  if (!looperInstState) {
    throw new Error(`Missing looper state for vcId=${vcId}`);
  }
  const serialized = serializeLooper(looperInstState);
  localStorage.setItem(stateKey, serialized);
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

