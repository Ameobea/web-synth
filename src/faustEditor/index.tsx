import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';

import type { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';
import { mkFaustEditorSmallView } from 'src/faustEditor/FaustEditorSmallView';
import DummyNode from 'src/graphEditor/nodes/DummyNode';
import { createPassthroughNode, OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import {
  buildDefaultFaustEditorPolyphonyState,
  buildFaustEditorReduxInfra,
  type SerializedFaustEditor,
} from 'src/redux/modules/faustEditor';
import FaustEditor from './FaustEditor';

const ctx = new AudioContext();

const buildRootNodeId = (vcId: string) => `faust-editor-react-root_${vcId}`;

export type FaustEditorReduxInfra = ReturnType<typeof buildFaustEditorReduxInfra>;

interface FaustEditorCtx {
  reduxInfra: FaustEditorReduxInfra;
  analyzerNode: AnalyserNode;
  faustNode?: DynamicCodeWorkletNode;
  overrideableParams: { [key: string]: OverridableAudioParam };
  isHidden: boolean;
  paramDefaultValues: { [paramName: string]: number };
  compileOnMount: boolean;
  optimize?: boolean;
}

export const faustEditorContextMap: { [vcId: string]: FaustEditorCtx } = {};

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
      isRunning: false,
    });

  const reduxInfra = buildFaustEditorReduxInfra(serializedEditor);
  faustEditorContextMap[vcId] = {
    reduxInfra,
    overrideableParams: {},
    analyzerNode,
    isHidden: false,
    paramDefaultValues: serializedEditor.paramDefaultValues ?? {},
    compileOnMount: serializedEditor.isRunning,
  };

  // Create the base dom node for the faust editor
  const faustEditorBase = document.createElement('div');

  faustEditorBase.id = buildRootNodeId(vcId);
  faustEditorBase.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none'
  );

  // Mount the newly created Faust editor and all of its accompanying components to the DOM
  document.getElementById('content')!.appendChild(faustEditorBase);

  mkContainerRenderHelper({
    Comp: FaustEditor,
    getProps: () => ({ vcId }),
    store: reduxInfra.store,
  })(buildRootNodeId(vcId));
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

  const instanceCtx = faustEditorContextMap[vcId];
  const { cachedInputNames, polyphonyState, language, optimize } =
    instanceCtx.reduxInfra.getState().faustEditor;

  const editorContent = get_faust_editor_content(vcId);
  delete faustEditorContextMap[vcId];

  const faustEditorReactRootNode = document.getElementById(buildRootNodeId(vcId));
  if (!faustEditorReactRootNode) {
    return editorContent;
  }

  mkContainerCleanupHelper()(buildRootNodeId(vcId));

  const serializedState: SerializedFaustEditor = {
    editorContent,
    cachedInputNames,
    polyphonyState,
    // If the instance is actively running, we grab the param values directly from the OAPs.
    // Otherwise, we get them from the serialized default values.
    paramDefaultValues: instanceCtx.faustNode
      ? Object.fromEntries(
          Object.entries(instanceCtx.overrideableParams).map(([paramName, param]) => [
            paramName,
            param.manualControl.offset.value,
          ])
        )
      : instanceCtx.paramDefaultValues,
    isRunning: !!instanceCtx.faustNode,
    language,
    optimize,
  };
  localStorage.setItem(stateKey, JSON.stringify(serializedState));
};

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
  mkContainerCleanupHelper({ preserveRoot: true })(domId);

export const get_faust_editor_connectables = (vcId: string): AudioConnectables => {
  const context = faustEditorContextMap[vcId];
  if (!context || !context.analyzerNode || !context.faustNode) {
    let cachedInputNames: string[] | undefined;
    if (context) {
      cachedInputNames = context.reduxInfra.getState().faustEditor.cachedInputNames;
    }

    const passthroughNode = createPassthroughNode(GainNode);
    let inputs = ImmMap<string, ConnectableInput>().set('input', {
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
      outputs: ImmMap<string, ConnectableOutput>().set('output', {
        node: passthroughNode,
        type: 'customAudio',
      }),
    };
  }

  const { faustNode, analyzerNode, paramDefaultValues, overrideableParams } = context;

  const baseInputs = ImmMap<string, ConnectableInput>().set('input', {
    node: faustNode,
    type: 'customAudio',
  });

  const settings = faustNode.getParamSettings(paramDefaultValues);
  const inputs = settings.reduce(
    (acc: ImmMap<string, ConnectableInput>, { label, address, initial }) => {
      // If we don't have an existing `overridableParam` for this input, we need to build one using the param
      // from the `AudioWorkletNode`
      if (!overrideableParams[address]) {
        // `as any` required due to incomplete typings in my IDE
        const workletParam: AudioParam = (faustNode.parameters as any).get(address);

        const overridableParam = new OverridableAudioParam(ctx, workletParam);

        // The param's value is set directly when the instance is constructed.  We switch it to
        // zero and allow the OAP to take over controlling the param
        overridableParam.wrappedParam.value = 0;
        overridableParam.manualControl.offset.value = initial;
        overrideableParams[address] = overridableParam;
      }

      return acc.set(label, {
        node: overrideableParams[address],
        type: 'number',
      });
    },
    baseInputs
  );

  return {
    vcId,
    inputs,
    outputs: ImmMap<string, ConnectableOutput>().set('output', {
      node: analyzerNode,
      type: 'customAudio',
    }),
  };
};
