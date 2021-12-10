import { buildStore } from 'jantix';
import { reducer as formReducer } from 'redux-form';

import viewContextManagerModule from 'src/redux/modules/viewContextManager';
import midiKeyboardModule from 'src/redux/modules/midiKeyboard';
import effectsModule from 'src/redux/modules/effects';
import presetsModule, {
  fetchSynthPresets,
  fetchSynthVoicePresets,
} from 'src/redux/modules/presets';
import controlPanelModule from 'src/redux/modules/controlPanel';
import equalizerModule from 'src/redux/modules/equalizer';
import sinsyModule from 'src/redux/modules/sinsy';
import looperSlice, { looperActions, LooperState } from 'src/redux/modules/looper';
import { ValueOf } from 'ameo-utils';
import genericPresetPickerSlice, {
  genericPresetPickerActions,
  GenericPresetPickerState,
} from 'src/redux/modules/genericPresetPicker';

const modules = {
  viewContextManager: viewContextManagerModule,
  midiKeyboard: midiKeyboardModule,
  effects: effectsModule,
  presets: presetsModule,
  controlPanel: controlPanelModule,
  equalizer: equalizerModule,
  sinsy: sinsyModule,
};

export const {
  store,
  getState: getStateInner,
  dispatch,
  actionCreators,
  useSelector,
} = buildStore<typeof modules>(modules, undefined, {
  form: formReducer,
  looper: looperSlice.reducer,
  genericPresetPicker: genericPresetPickerSlice.reducer,
});

export type ReduxStore = ReturnType<typeof getStateInner> & {
  looper: LooperState;
  genericPresetPicker: GenericPresetPickerState;
};

export const getState = (): ReduxStore => getStateInner() as any;

// Fixing the types isn't worth my time
export const looperDispatch = (action: ReturnType<ValueOf<typeof looperActions>>) =>
  dispatch(action as any);
export const genericPresetDispatch = (
  action: ReturnType<ValueOf<typeof genericPresetPickerActions>>
) => dispatch(action as any);

// Don't mind my side effects; they're harmless I promise
fetchSynthPresets();
fetchSynthVoicePresets();

(window as any).getState = getState;
