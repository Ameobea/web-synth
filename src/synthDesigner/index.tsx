import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Try, Option } from 'funfix-core';

import { store } from 'src/redux';
import { SynthDesignerState } from 'src/redux/modules/synthDesigner';
import SynthDesigner from './SynthDesigner';

const ROOT_NODE_ID = 'synth-designer-react-root' as const;

export const init_synth_designer = (stateKey: string) => {
  // Retrieve the initial synth designer content from `localStorage` (if it's set)
  const initialState = Try.of(() =>
    Option.of(localStorage.getItem(stateKey))
      .map(serializedState => JSON.parse(serializedState) as SynthDesignerState)
      .orNull()
  ).getOrElseL(() => {
    console.warn(
      'Error deserializing synth designer state from JSON; clearing and defaulting to empty'
    );
    localStorage.removeItem(stateKey);
    return null;
  });

  // Create the base dom node for the faust editor
  const synthDesignerBase = document.createElement('div');
  synthDesignerBase.id = ROOT_NODE_ID;
  synthDesignerBase.setAttribute(
    'style',
    'z-index: 2; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(synthDesignerBase);
  ReactDOM.render(
    <Provider store={store}>
      <SynthDesigner initialState={initialState} />
    </Provider>,
    synthDesignerBase
  );
};

export const cleanup_synth_designer = (): string => {
  const designerState = 'TODO';
  const faustEditorReactRootNode = document.getElementById(ROOT_NODE_ID);
  if (!faustEditorReactRootNode) {
    return designerState;
  }

  ReactDOM.unmountComponentAtNode(faustEditorReactRootNode);
  faustEditorReactRootNode.remove();
  return designerState;
};
