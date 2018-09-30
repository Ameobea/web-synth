import { applyMiddleware, createStore, combineReducers, compose } from 'redux';
const composeEnhancers = (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

import settingsReducer from './settings';

const reducers = { settings: settingsReducer };

export const store = createStore(
  combineReducers(reducers),
  (window as any).__REDUX_DEVTOOLS_EXTENSION__ && (window as any).__REDUX_DEVTOOLS_EXTENSION__()
);
