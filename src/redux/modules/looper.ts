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
  compositionLenBeats: number | null;
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
  compositionLenBeats: null,
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

const updateLooperConnectables = (vcId: string, afterUpdateConnectables?: () => void) =>
  setTimeout(() => {
    updateConnectables(vcId, get_looper_audio_connectables(vcId));
    afterUpdateConnectables?.();
  });

const computeCompositionLenBeats = (composition: SavedMIDIComposition): number =>
  composition.composition.lines.reduce(
    (acc, line) =>
      line.notes.reduce((acc, event) => Math.max(acc, event.startPoint + event.length), acc),
    0
  );

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
      const instState = state.stateByVcId[vcId];
      const moduleState = instState.modules[moduleIx];
      const bankIx = moduleState.banks.findIndex(bank => bank.id === bankId);
      const isActive = moduleState.activeBankIx === bankIx;
      moduleState.banks = moduleState.banks.filter(bank => bank.id !== bankId);
      if (isActive) {
        moduleState.activeBankIx = null;
        instState.looperNode.setActiveBankIx(moduleIx, null);
        instState.looperNode.setCompositionForBank(moduleIx, bankIx, null, 8);
      }
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
      modulestate.banks[bankIx].compositionLenBeats = computeCompositionLenBeats(composition);
      instState.looperNode.setCompositionForBank(
        moduleIx,
        bankIx,
        composition,
        modulestate.banks[bankIx].lenBeats
      );
    },
    setLoopLenBeats: (
      state,
      {
        payload: { vcId, moduleIx, bankIx, lenBeats },
      }: PayloadAction<{ vcId: string; moduleIx: number; bankIx: number; lenBeats: number }>
    ) => {
      const instState = state.stateByVcId[vcId];
      const modulestate = instState.modules[moduleIx];
      modulestate.banks[bankIx].lenBeats = lenBeats;
      instState.looperNode.setLoopLenBeats(moduleIx, bankIx, lenBeats);
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
      const newModule = buildDefaultLooperModule(newModuleIx);
      let i = 1;
      while (instState.modules.some(module => module.name === newModule.name)) {
        newModule.name = `${newModule.name}_${i}`;
        i++;
      }

      instState.modules.push(newModule);
      instState.looperNode.setActiveModuleIx(newModuleIx);
      instState.activeModuleIx = newModuleIx;

      updateLooperConnectables(action.payload.vcId);
    },
    removeModule: (state, action: PayloadAction<{ vcId: string; moduleIx: number }>) => {
      const instState = state.stateByVcId[action.payload.vcId];
      const moduleToDelete = instState.modules[action.payload.moduleIx];
      if (!moduleToDelete) {
        return;
      }

      instState.modules.splice(action.payload.moduleIx, 1);

      // This has the effect of shifting down modules in the backend, so states should match
      instState.looperNode.deleteModule(instState.modules.length);

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
        payload: { vcId, moduleIx, name, afterUpdateConnectables },
      }: PayloadAction<{
        vcId: string;
        moduleIx: number;
        name: string;
        afterUpdateConnectables?: () => void;
      }>
    ) => {
      const instState = state.stateByVcId[vcId];
      instState.modules[moduleIx].name = name;

      updateLooperConnectables(vcId, afterUpdateConnectables);
    },
  },
});

export const looperActions = looperSlice.actions;

export default looperSlice;
