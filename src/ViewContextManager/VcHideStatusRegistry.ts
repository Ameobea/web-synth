import type { ReduxStore } from 'src/redux';

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
  const activeVcId =
    state.viewContextManager.activeViewContexts[state.viewContextManager.activeViewContextIx].uuid;
  return activeVcId !== vcId;
};
