import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import type { SavedMIDIComposition } from 'src/api';
import { getIsGlobalBeatCounterStarted } from 'src/eventScheduler';
import { get_looper_audio_connectables } from 'src/looper/Looper';
import type { LooperNode } from 'src/looper/LooperNode';
import { updateConnectables } from 'src/patchNetwork/interface';
import { genRandomStringID } from 'src/util';

export interface LooperBank {
  id: string;
  loadedComposition: SavedMIDIComposition | null;
  lenBeats: number;
}

export interface LooperModule {
  name: string;
  activeBankIx: number | null;
  banks: LooperBank[];
}

export interface LooperInstState {
  modules: LooperModule[];
  activeModuleIx: number;
  isHidden: boolean;
  looperNode: LooperNode;
  phaseSAB: Float32Array | null;
}

export interface LooperState {
  stateByVcId: { [vcId: string]: LooperInstState };
}

export interface SerializedLooperInstState {
  modules: LooperModule[];
  activeModuleIx: number;
}

export const deserializeLooper = (serialized: string): Omit<LooperInstState, 'looperNode'> => {
  const parsed: SerializedLooperInstState = JSON.parse(serialized);
  return { ...parsed, phaseSAB: null, isHidden: true };
};

export const serializeLooper = (looperState: LooperInstState): string => {
  const serialized: SerializedLooperInstState = { ...looperState };
  return JSON.stringify(serialized);
};

const buildDefaultLooperBank = (): LooperBank => ({
  id: genRandomStringID(),
  loadedComposition: null,
  lenBeats: 8,
});

const buildDefaultLooperModule = (moduleIx: number): LooperModule => ({
  name: `Module ${moduleIx + 1}`,
  activeBankIx: null,
  banks: [buildDefaultLooperBank()],
});

export const buildDefaultLooperInstState = (): Omit<LooperInstState, 'looperNode'> => ({
  modules: [buildDefaultLooperModule(0)],
  activeModuleIx: 0,
  phaseSAB: null,
  isHidden: true,
});

const buildDefaultLooperState = (): LooperState => ({
  stateByVcId: {},
});

const updateLooperConnectables = (vcId: string) =>
  setTimeout(() => updateConnectables(vcId, get_looper_audio_connectables(vcId)));

const looperSlice = createSlice({
  name: 'looper',
  initialState: buildDefaultLooperState(),
  reducers: {
    setLooperInstState: (
      state,
      action: PayloadAction<{ vcId: string; state: LooperInstState }>
    ) => {
      state.stateByVcId[action.payload.vcId] = action.payload.state;
    },
    addBank: (state, action: PayloadAction<{ vcId: string; moduleIx: number }>) => {
      const modulestate = state.stateByVcId[action.payload.vcId].modules[action.payload.moduleIx];
      modulestate.banks.push(buildDefaultLooperBank());
    },
    deleteBank: (
      state,
      {
        payload: { vcId, moduleIx, bankId },
      }: PayloadAction<{ vcId: string; moduleIx: number; bankId: string }>
    ) => {
      const modulestate = state.stateByVcId[vcId].modules[moduleIx];
      modulestate.banks = modulestate.banks.filter(bank => bank.id !== bankId);
    },
    setLoadedComposition: (
      state,
      {
        payload: { vcId, moduleIx, bankIx, composition },
      }: PayloadAction<{
        vcId: string;
        moduleIx: number;
        bankIx: number;
        composition: SavedMIDIComposition;
      }>
    ) => {
      const instState = state.stateByVcId[vcId];
      const modulestate = instState.modules[moduleIx];
      modulestate.banks[bankIx].loadedComposition = composition;
      instState.looperNode.setCompositionForBank(
        moduleIx,
        bankIx,
        composition,
        modulestate.banks[bankIx].lenBeats
      );
    },
    setActiveBankIx: (
      state,
      {
        payload: { vcId, moduleIx, bankIx },
      }: PayloadAction<{ vcId: string; moduleIx: number; bankIx: number | null }>
    ) => {
      const instState = state.stateByVcId[vcId];
      const modulestate = instState.modules[moduleIx];
      modulestate.activeBankIx = bankIx;

      const isGlobalPlaying = getIsGlobalBeatCounterStarted();
      if (isGlobalPlaying) {
        if (bankIx !== null) {
          instState.looperNode.setNextBankIx(moduleIx, bankIx);
        }
      } else {
        instState.looperNode.setActiveBankIx(moduleIx, bankIx);
      }
    },
    setPhaseSAB: (
      state,
      { payload: { vcId, phaseSAB } }: PayloadAction<{ vcId: string; phaseSAB: Float32Array }>
    ) => {
      const instState = state.stateByVcId[vcId];
      instState.phaseSAB = phaseSAB;
    },
    setIsHidden: (
      state,
      { payload: { vcId, isHidden } }: PayloadAction<{ vcId: string; isHidden: boolean }>
    ) => {
      const instState = state.stateByVcId[vcId];
      instState.isHidden = isHidden;
    },
    setActiveModuleIx: (
      state,
      { payload: { vcId, moduleIx } }: PayloadAction<{ vcId: string; moduleIx: number }>
    ) => {
      const instState = state.stateByVcId[vcId];
      instState.looperNode.setActiveModuleIx(moduleIx);
      instState.activeModuleIx = moduleIx;
    },
    addModule: (state, action: PayloadAction<{ vcId: string }>) => {
      const instState = state.stateByVcId[action.payload.vcId];
      const newModuleIx = instState.modules.length;
      instState.modules.push(buildDefaultLooperModule(newModuleIx));
      instState.looperNode.setActiveModuleIx(newModuleIx);
      instState.activeModuleIx = newModuleIx;

      updateLooperConnectables(action.payload.vcId);
    },
    removeModule: (state, action: PayloadAction<{ vcId: string; moduleIx: number }>) => {
      const instState = state.stateByVcId[action.payload.vcId];

      instState.modules.splice(action.payload.moduleIx, 1);
      if (instState.modules.length <= 1) {
        updateLooperConnectables(action.payload.vcId);
        return;
      }

      let i = action.payload.moduleIx;
      while (i >= 0) {
        if (instState.modules[i]) {
          instState.looperNode.setActiveModuleIx(i);
          instState.activeModuleIx = i;
          break;
        }
        i -= 1;
      }

      updateLooperConnectables(action.payload.vcId);
    },
    setModuleName: (
      state,
      {
        payload: { vcId, moduleIx, name },
      }: PayloadAction<{ vcId: string; moduleIx: number; name: string }>
    ) => {
      const instState = state.stateByVcId[vcId];
      instState.modules[moduleIx].name = name;

      updateLooperConnectables(vcId);
    },
  },
});

export const looperActions = looperSlice.actions;

export default looperSlice;
