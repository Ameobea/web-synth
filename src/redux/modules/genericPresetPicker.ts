import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface GenericPresetPickerState {
  selectedPresetID: string | number | null | undefined;
}

const buildInitialState = (): GenericPresetPickerState => ({ selectedPresetID: null });

const genericPresetPickerSlice = createSlice({
  name: 'genericPresetPicker',
  initialState: buildInitialState(),
  reducers: {
    setSelectedPresetID: (state, action: PayloadAction<number | string | null>) => {
      state.selectedPresetID = action.payload;
    },
  },
});

export const genericPresetPickerActions = genericPresetPickerSlice.actions;

export default genericPresetPickerSlice;
