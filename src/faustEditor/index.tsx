import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Map } from 'immutable';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import FaustEditor from './FaustEditor';
import { AudioConnectables, ConnectableOutput, ConnectableInput } from 'src/patchNetwork';
import { FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { createPassthroughNode, OverridableAudioParam } from 'src/graphEditor/nodes/util';
import {
  SerializedFaustEditor,
  buildDefaultFaustEditorPolyphonyState,
  buildFaustEditorReduxInfra,
} from 'src/redux/modules/faustEditor';
import { mkContainerRenderHelper, mkContainerCleanupHelper } from 'src/reactUtils';
import { mkFaustEditorSmallView } from 'src/faustEditor/FaustEditorSmallView';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { getFaustParamBasePath } from 'src/faustEditor/uiBuilder';

const ctx = new AudioContext();

const buildRootNodeId = (vcId: string) => `faust-editor-react-root_${vcId}`;

export type FaustEditorReduxInfra = ReturnType<typeof buildFaustEditorReduxInfra>;

export const faustEditorContextMap: {
  [vcId: string]: {
    reduxInfra: FaustEditorReduxInfra;
    analyzerNode: AnalyserNode;
    faustNode?: FaustWorkletNode;
    overrideableParams: { [key: string]: OverridableAudioParam };
    isHidden: boolean;
  };
} = {};

const getReduxInfra = (vcId: string) => {
  const context = faustEditorContextMap[vcId];
  if (!context) {
    throw new Error(`No context set for Faust editor with vcId ${vcId}`);
  }
  return context.reduxInfra;
};

export const init_faust_editor = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  // Construct new Redux infra for this instance and set it into the map
  if (faustEditorContextMap[vcId]) {
    console.error(
      `There's an existing entry in the Faust editor context map for vcId ${vcId}; skipping init.`
    );
    return;
  }

  const analyzerNode = ctx.createAnalyser();
  analyzerNode.smoothingTimeConstant = 0.2;

  const serializedEditor: SerializedFaustEditor = Option.of(localStorage.getItem(stateKey))
    .flatMap(val => {
      try {
        const parsed = JSON.parse(val) as SerializedFaustEditor;
        // Backwards compat to when that field didn't exist
        if (!parsed.polyphonyState) {
          parsed.polyphonyState = buildDefaultFaustEditorPolyphonyState();
        }
        return Option.of(parsed);
      } catch (err) {
        console.error('Error parsing localstorage content for Faust editor; resetting to scratch.');
        return Option.none();
      }
    })
    .getOrElse({
      cachedInputNames: undefined,
      editorContent: '',
      polyphonyState: buildDefaultFaustEditorPolyphonyState(),
    });

  const reduxInfra = buildFaustEditorReduxInfra(serializedEditor);
  faustEditorContextMap[vcId] = {
    reduxInfra,
    overrideableParams: {},
    analyzerNode,
    isHidden: false,
  };

  // Create the base dom node for the faust editor
  const faustEditorBase = document.createElement('div');

  faustEditorBase.id = buildRootNodeId(vcId);
  faustEditorBase.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: 100vh; position: absolute; top: 0; left: 0; display: none'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(faustEditorBase);
  ReactDOM.render(
    <Provider store={reduxInfra.store}>
      <FaustEditor vcId={vcId} />
    </Provider>,
    faustEditorBase
  );
};

export const get_faust_editor_content = (vcId: string) => {
  const reduxInfra = getReduxInfra(vcId);
  return reduxInfra.getState().faustEditor.editorContent;
};

export const hide_faust_editor = (vcId: string) => {
  const ctx = faustEditorContextMap[vcId];
  if (ctx) {
    ctx.reduxInfra.dispatch(ctx.reduxInfra.actionCreators.faustEditor.SET_IS_HIDDEN(true));
  } else {
    console.error(
      `Tried to hide Faust editor with vcId ${vcId} but no entry exists in the context map for it`
    );
  }

  const rootNode = document.getElementById(buildRootNodeId(vcId));
  if (!rootNode) {
    console.warn(`Tried to hide faust editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'none';
};

export const unhide_faust_editor = (vcId: string) => {
  const ctx = faustEditorContextMap[vcId];
  if (ctx) {
    ctx.reduxInfra.dispatch(ctx.reduxInfra.actionCreators.faustEditor.SET_IS_HIDDEN(false));
  } else {
    console.error(
      `Tried to un-hide Faust editor with vcId ${vcId} but no entry exists in the context map for it`
    );
  }

  const rootNode = document.getElementById(buildRootNodeId(vcId));
  if (!rootNode) {
    console.warn(`Tried to unhide faust editor with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'block';
};

export const cleanup_faust_editor = (stateKey: string) => {
  const vcId = stateKey.split('_')[1]!;

  const { cachedInputNames, polyphonyState } = faustEditorContextMap[
    vcId
  ].reduxInfra.getState().faustEditor;

  const editorContent = get_faust_editor_content(vcId);
  delete faustEditorContextMap[vcId];

  const faustEditorReactRootNode = document.getElementById(buildRootNodeId(vcId));
  if (!faustEditorReactRootNode) {
    return editorContent;
  }

  ReactDOM.unmountComponentAtNode(faustEditorReactRootNode);
  faustEditorReactRootNode.remove();

  const serializedState: SerializedFaustEditor = {
    editorContent,
    cachedInputNames,
    polyphonyState,
  };
  localStorage.setItem(stateKey, JSON.stringify(serializedState));
};

/**
 * One item from the json def's `ui` property.  Defines one UI component and optinally an array of child UI components
 * if this UI component is a container.
 */
interface UIItem {
  type: string;
  address: string;
  items?: UIItem[];
}

// Taken from https://stackoverflow.com/a/53710250/3833068
type NestedArray<T> = (T | NestedArray<T>)[];

const parseUIItem = (item: UIItem): NestedArray<string> =>
  ['vgroup', 'hgroup'].includes(item.type)
    ? item.items!.map(parseUIItem)
    : [item.address.replace(/\s/g, '_')];

export const render_faust_editor_small_view = (vcId: string, domId: string) => {
  const context = faustEditorContextMap[vcId];
  if (!context) {
    throw new Error(`No context for Faust editor with vcId ${vcId} when rendering small view`);
  }

  mkContainerRenderHelper({
    Comp: mkFaustEditorSmallView(vcId),
    getProps: () => ({}),
    store: context.reduxInfra.store,
  })(domId);
};

export const cleanup_faust_editor_small_view = (_vcId: string, domId: string) =>
  mkContainerCleanupHelper()(domId);

export const get_faust_editor_connectables = (vcId: string): AudioConnectables => {
  const context = faustEditorContextMap[vcId];
  if (!context || !context.analyzerNode || !context.faustNode) {
    let cachedInputNames: string[] | undefined;
    if (context) {
      // Prevent these from leaking
      context.overrideableParams = {};

      cachedInputNames = context.reduxInfra.getState().faustEditor.cachedInputNames;
    }

    const passthroughNode = createPassthroughNode(GainNode);
    let inputs = Map<string, ConnectableInput>().set('input', {
      node: passthroughNode,
      type: 'customAudio',
    });

    if (cachedInputNames) {
      inputs = cachedInputNames.reduce(
        (acc, inputName) => acc.set(inputName, { type: 'number', node: new DummyNode() }),
        inputs
      );
    }

    // Create passthrough audio node with the same interface as the `FaustAudioWorklet`-based ones that will be created later
    // once our Faust code is compiled.  This should cause any connections made before the faust module is started to be re-
    // connected to the real faust node once it is started.
    return {
      vcId,
      inputs,
      outputs: Map<string, ConnectableOutput>().set('output', {
        node: passthroughNode,
        type: 'customAudio',
      }),
    };
  }

  const { faustNode, analyzerNode } = context;

  const baseInputs = Map<string, ConnectableInput>().set('input', {
    node: faustNode,
    type: 'customAudio',
  });

  const flattenedUIItems = (R.flatten(
    (faustNode.jsonDef.ui as UIItem[]).map(item => parseUIItem(item))
  ) as unknown) as string[];
  const inputs = flattenedUIItems.reduce((acc: Map<string, ConnectableInput>, label: string) => {
    // If we don't have an existing `overridableParam` for this input, we need to build one using the param
    // from the `AudioWorkletNode`
    if (!context.overrideableParams[label]) {
      // `as any` required due to incomplete typings in my IDE
      const workletParam: AudioParam = (faustNode.parameters as any).get(label);

      const overridableParam = new OverridableAudioParam(ctx, workletParam);
      context.overrideableParams[label] = overridableParam;
    }

    const trimmedLabel = label.split('/').slice(2).join('/');

    return acc.set(trimmedLabel, {
      node: context.overrideableParams[label],
      type: 'number',
    });
  }, baseInputs);

  return {
    vcId,
    inputs,
    outputs: Map<string, ConnectableOutput>().set('output', {
      node: analyzerNode,
      type: 'customAudio',
    }),
  };
};
