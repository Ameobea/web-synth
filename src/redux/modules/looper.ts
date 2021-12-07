import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { SavedMIDIComposition } from 'src/api';
import { getIsGlobalBeatCounterStarted } from 'src/eventScheduler';
import type { LooperNode } from 'src/looper/LooperNode';
import { genRandomStringID } from 'src/util';

export interface LooperBank {
  id: string;
  loadedComposition: SavedMIDIComposition | null;
}

export interface LooperInstState {
  activeBankIx: number | null;
  banks: LooperBank[];
  looperNode: LooperNode;
  phaseSAB: Float32Array | null;
  isHidden: boolean;
}

export interface LooperState {
  stateByVcId: { [vcId: string]: LooperInstState };
}

export interface SerializedLooperInstState {
  activeBankIx: number | null;
  banks: LooperBank[];
}

export const buildDefaultLooperInstState = (): Omit<LooperInstState, 'looperNode'> => ({
  activeBankIx: null,
  banks: [],
  phaseSAB: null,
  isHidden: true,
});

const buildDefaultLooperState = (): LooperState => ({
  stateByVcId: {},
});

const buildDefaultLooperBank = (): LooperBank => ({
  id: genRandomStringID(),
  loadedComposition: null,
});

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
    addBank: (state, action: PayloadAction<{ vcId: string }>) => {
      const instState = state.stateByVcId[action.payload.vcId];
      instState.banks.push(buildDefaultLooperBank());
    },
    deleteBank: (state, action: PayloadAction<{ vcId: string; bankId: string }>) => {
      const instState = state.stateByVcId[action.payload.vcId];
      instState.banks = instState.banks.filter(bank => bank.id !== action.payload.bankId);
    },
    setLoadedComposition: (
      state,
      {
        payload: { vcId, bankIx, composition },
      }: PayloadAction<{ vcId: string; bankIx: number; composition: SavedMIDIComposition }>
    ) => {
      const instState = state.stateByVcId[vcId];
      instState.banks[bankIx].loadedComposition = composition;
      instState.looperNode.setCompositionForBank(bankIx, composition);
    },
    setActiveBankIx: (
      state,
      { payload: { vcId, bankIx } }: PayloadAction<{ vcId: string; bankIx: number }>
    ) => {
      const instState = state.stateByVcId[vcId];
      instState.activeBankIx = bankIx;

      const isGlobalPlaying = getIsGlobalBeatCounterStarted();
      if (isGlobalPlaying) {
        instState.looperNode.setNextBankIx(bankIx);
      } else {
        instState.looperNode.setActiveBankIx(bankIx);
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
  },
});

export const looperActions = looperSlice.actions;

export default looperSlice;
