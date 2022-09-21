import type { ValueOf } from 'ameo-utils';
import { buildStore } from 'jantix';

import controlPanelModule from 'src/redux/modules/controlPanel';
import equalizerModule from 'src/redux/modules/equalizer';
import genericPresetPickerSlice, {
  genericPresetPickerActions,
  GenericPresetPickerState,
} from 'src/redux/modules/genericPresetPicker';
import looperSlice, { looperActions, LooperState } from 'src/redux/modules/looper';
import midiKeyboardModule from 'src/redux/modules/midiKeyboard';
import presetsModule, {
  fetchSynthPresets,
  fetchSynthVoicePresets,
} from 'src/redux/modules/presets';
import sinsyModule from 'src/redux/modules/sinsy';
import viewContextManagerModule from 'src/redux/modules/viewContextManager';

const modules = {
  viewContextManager: viewContextManagerModule,
  midiKeyboard: midiKeyboardModule,
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
