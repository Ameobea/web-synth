import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface GenericPresetPickerState {
  selectedPresetIx: number | null;
}

const buildInitialState = (): GenericPresetPickerState => ({ selectedPresetIx: null });

const genericPresetPickerSlice = createSlice({
  name: 'genericPresetPicker',
  initialState: buildInitialState(),
  reducers: {
    setSelectedPresetIx: (state, action: PayloadAction<number | null>) => {
      state.selectedPresetIx = action.payload;
    },
  },
});

export const genericPresetPickerActions = genericPresetPickerSlice.actions;

export default genericPresetPickerSlice;
