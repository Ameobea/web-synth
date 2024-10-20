import { useEffect, useState } from 'react';
import { getState, type ReduxStore } from 'src/redux';
import { onDestroy, onMount } from 'svelte';
import { writable, type Readable } from 'svelte/store';

type VcHideCb = (isHidden: boolean) => void;

const VcHideCbsByVcId = new Map<string, VcHideCb[]>();

/**
 * Register a callback to be called whenever the VC with the provided ID is hidden or unhidden
 */
export const registerVcHideCb = (vcId: string, cb: VcHideCb) => {
  if (!VcHideCbsByVcId.has(vcId)) {
    VcHideCbsByVcId.set(vcId, []);
  }
  VcHideCbsByVcId.get(vcId)!.push(cb);
};

/**
 * Unregister a callback previously registered with `registerVcHideCb`
 */
export const unregisterVcHideCb = (vcId: string, cb: VcHideCb) => {
  if (!VcHideCbsByVcId.has(vcId)) {
    console.warn(`No VC hide callbacks have been registered for vcId=${vcId}`);
    return;
  }
  const newCbs = VcHideCbsByVcId.get(vcId)!.filter(ocb => ocb !== cb);
  VcHideCbsByVcId.set(vcId, newCbs);
};

export const useIsVcHidden = (vcId: string): boolean => {
  const [isHidden, setIsHidden] = useState(
    getState().viewContextManager.activeViewContextId !== vcId
  );
  useEffect(() => {
    registerVcHideCb(vcId, setIsHidden);
    return () => unregisterVcHideCb(vcId, setIsHidden);
  }, [vcId]);

  return isHidden;
};

// TODO: I feel like this would be an actually good use of Runes in Svelte 5
export const createVcIsHiddenStore = (vcId: string): Readable<boolean> => {
  const store = writable(getState().viewContextManager.activeViewContextId === vcId);
  const cb = (newIsHidden: boolean) => store.set(newIsHidden);
  onMount(() => registerVcHideCb(vcId, cb));
  onDestroy(() => unregisterVcHideCb(vcId, cb));
  return { subscribe: store.subscribe };
};

/**
 * This is called from the Rust engine and handles calling the callbacks registered by `registerVcHideCb`.
 *
 * It should not be called outside of that spot.
 */
export const onVcHideStatusChange = (vcId: string, isHidden: boolean) =>
  VcHideCbsByVcId.get(vcId)?.forEach(cb => cb(isHidden));

let mainReduxGetState: (() => ReduxStore) | null = null;

export const registerMainReduxGetState = (getState: () => ReduxStore) => {
  mainReduxGetState = getState;
};

export const getIsVcHidden = (vcId: string): boolean => {
  if (!mainReduxGetState) {
    console.error(
      `Tried to check if vcId=${vcId} is hidden, but main Redux handle has not been registered`
    );
    return false;
  }
  const state = mainReduxGetState();
  const vc = state.viewContextManager.activeViewContexts.find(
    vc => vc.uuid === state.viewContextManager.activeViewContextId
  );
  if (!vc) {
    console.warn(
      `Tried to check if vcId=${vcId} is hidden, but no active VC was found in Redux state`
    );
    return true;
  }
  const activeVcId = vc.uuid;
  return activeVcId !== vcId;
};
