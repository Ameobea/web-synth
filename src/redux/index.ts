/**
 * Initialize the Redux store + subreducers
 */

import { applyMiddleware, createStore, combineReducers, compose } from 'redux';

import synthsReducer from './reducers/synths';

const reducers = {
  synths: synthsReducer,
};

const composeEnhancers = (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

export const store = createStore(combineReducers(reducers));
