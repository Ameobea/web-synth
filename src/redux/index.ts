/**
 * Initialize the Redux store + subreducers
 */

import { applyMiddleware, createStore, combineReducers, compose } from 'redux';
import { StateType, ActionType } from 'typesafe-actions';

import synthsReducer from './reducers/synths';
import viewContextManagerReducer from './reducers/viewContextManager';

const reducers = {
  synths: synthsReducer,
  viewContextManager: viewContextManagerReducer,
};

const composeEnhancers = (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

const rootReducer = combineReducers(reducers);

export const store = createStore(rootReducer, {}, composeEnhancers());

export type State = StateType<typeof rootReducer>;
