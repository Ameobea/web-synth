import { buildStore } from 'jantix';
import { reducer as formReducer } from 'redux-form';

import viewContextManagerModule from './modules/viewContextManager';
import midiKeyboardModule from './modules/midiKeyboard';
import effectsModule from './modules/effects';
import presetsModule, { fetchSynthPresets, fetchSynthVoicePresets } from './modules/presets';
import controlPanelModule from './modules/controlPanel';
import equalizerModule from 'src/redux/modules/equalizer';
import sinsyModule from 'src/redux/modules/sinsy';

const modules = {
  viewContextManager: viewContextManagerModule,
  midiKeyboard: midiKeyboardModule,
  effects: effectsModule,
  presets: presetsModule,
  controlPanel: controlPanelModule,
  equalizer: equalizerModule,
  sinsy: sinsyModule,
};

export const { store, getState, dispatch, actionCreators, useSelector } = buildStore<
  typeof modules
>(modules, undefined, { form: formReducer });

// Don't mind my side effects; they're harmless I promise
fetchSynthPresets();
fetchSynthVoicePresets();

(window as any).getState = getState;

export type ReduxStore = ReturnType<typeof getState>;
