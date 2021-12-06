import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface LooperBank {}

export interface LooperInstState {
  activeBankIx: number | null;
  banks: LooperBank[];
}

export interface LooperState {
  stateByVcId: { [vcId: string]: LooperInstState };
}

export interface SerializedLooperInstState {
  activeBankIx: number | null;
  banks: LooperBank[];
}

export const buildDefaultLooperInstState = (): LooperInstState => ({
  activeBankIx: null,
  banks: [],
});

const buildDefaultLooperState = (): LooperState => ({
  stateByVcId: {},
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
  },
});

export const looperActions = looperSlice.actions;

export default looperSlice;
