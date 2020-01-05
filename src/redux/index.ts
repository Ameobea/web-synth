import { buildStore } from 'jantix';
import { reducer as formReducer } from 'redux-form';

import synthsModule from './modules/synths';
import viewContextManagerModule from './modules/viewContextManager';
import midiKeyboardModule from './modules/midiKeyboard';
import effectsModule from './modules/effects';
import presetsModule, { fetchSynthPresets, fetchSynthVoicePresets } from './modules/presets';

const modules = {
  synths: synthsModule,
  viewContextManager: viewContextManagerModule,
  midiKeyboard: midiKeyboardModule,
  effects: effectsModule,
  presets: presetsModule,
};

export const { store, getState, dispatch, actionCreators, useSelector } = buildStore<
  typeof modules
>(modules, undefined, { form: formReducer });

// Don't mind my side effects; they're harmless I promise
fetchSynthPresets();
fetchSynthVoicePresets();

(window as any).getState = getState;

export type ReduxStore = ReturnType<typeof getState>;
