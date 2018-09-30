import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { connect, Provider } from 'react-redux';

const wasm = import('./engine');
import { store } from 'src/reducers';
import { main } from './chords';
import App from './App';

wasm.then(main);

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);
