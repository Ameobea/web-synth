import { buildStore } from 'jantix';
import { reducer as formReducer } from 'redux-form';

import synthsModule from './modules/synths';
import viewContextManagerModule from './modules/viewContextManager';

import effectsModule from './modules/effects';

const modules = {
  synths: synthsModule,
  viewContextManager: viewContextManagerModule,

  effects: effectsModule,
};

export const { store, getState, dispatch, actionCreators } = buildStore<typeof modules>(
  modules,
  undefined,
  { form: formReducer }
);

(window as any).getState = getState;

export type ReduxStore = ReturnType<typeof getState>;
