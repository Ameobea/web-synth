/**
 * Initialize the Redux store + subreducers
 */

import { createStore, combineReducers, compose } from 'redux';
import { StateType } from 'typesafe-actions';

import synthsReducer from './reducers/synths';
import viewContextManagerReducer from './reducers/viewContextManager';
import faustEditorReducer from './reducers/faustEditor';
import effectsReducer from './reducers/effects';

const reducers = {
  synths: synthsReducer,
  viewContextManager: viewContextManagerReducer,
  faustEditor: faustEditorReducer,
  effects: effectsReducer,
};

const composeEnhancers = (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

const rootReducer = combineReducers(reducers);

export const store = createStore(rootReducer, {}, composeEnhancers());

(window as any).getState = () => store.getState();

export type State = StateType<typeof rootReducer>;
