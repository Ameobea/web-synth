import { Option } from 'funfix-core';
import React, { Suspense } from 'react';

import Loading from 'src/misc/Loading';
import type { AudioConnectables } from 'src/patchNetwork';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import { actionCreators, dispatch, getState, store } from 'src/redux';
import { buildDefaultSinsyState } from 'src/redux/modules/sinsy';
import type { SinsyState } from 'src/redux/modules/sinsy';
import { create_empty_audio_connectables } from 'src/redux/modules/vcmUtils';
import { AsyncOnce, UnimplementedError, type PropTypesOf } from 'src/util';

const SinsyUI = React.lazy(() => import('./SinsyUI'));

const LazySinsyUI: React.FC<PropTypesOf<(typeof import('./SinsyUI'))['default']>> = props => (
  <Suspense fallback={<Loading />}>
    <SinsyUI {...props} />
  </Suspense>
);

const getSinsyDOMElementId = (vcId: string) => `sinsy_${vcId}`;

const SinsyModule = new AsyncOnce(async () => {
  // eslint-disable-next-line no-var
  (window as any).Module = {
    onRuntimeInitialized: function () {
      const Module = (window as any).Module;
      console.log('Sinsy finished loading!', Module);
      dispatch(actionCreators.sinsy.SET_SINSY_MODULE(Module));
      (window as any).Module = {};
    },
  };
  const script = document.createElement('script');
  script.src = '/sinsy.js';
  script.onload = () => console.log('sinsy script loaded');
  document.head.appendChild(script);
});

export const init_sinsy = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const domId = getSinsyDOMElementId(vcId);
  SinsyModule.get();

  const elem = document.createElement('div');
  elem.id = domId;
  elem.setAttribute(
    'style',
    'z-index: 2;width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const initialState: SinsyState = Option.of(localStorage.getItem(stateKey))
    .flatMap(k => {
      try {
        return Option.of(JSON.parse(k));
      } catch (err) {
        console.warn('Failed to parse stored sinsy state; returning default');
        return Option.none();
      }
    })
    .getOrElseL(buildDefaultSinsyState);
  dispatch(actionCreators.sinsy.SET_SINSY_STATE(vcId, initialState));

  mkContainerRenderHelper({
    Comp: LazySinsyUI,
    store,
    getProps: () => ({ vcId }),
  })(domId);
};

export const hide_sinsy = mkContainerHider(getSinsyDOMElementId);

export const unhide_sinsy = mkContainerUnhider(getSinsyDOMElementId);

export const cleanup_sinsy = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const serializedState = JSON.stringify(getState().sinsy.instances[vcId]);
  localStorage.setItem(stateKey, serializedState);

  mkContainerCleanupHelper({})(getSinsyDOMElementId(vcId));
};

export const get_sinsy_audio_connectables = (vcId: string): AudioConnectables => {
  return create_empty_audio_connectables(vcId);
};

export const loadHTSVoice = async (htsVoiceName: string): Promise<Uint8Array | string> => {
  // Currently we special-case the nitech voice
  // TODO: Cache in indexdb or service worker or something
  if (htsVoiceName === 'nitech_jp_song070_f001') {
    const data = await fetch('https://i.ameo.link/8tg.htsvoice').then(res => res.arrayBuffer());
    return new Uint8Array(data);
  }

  throw new UnimplementedError();
};
