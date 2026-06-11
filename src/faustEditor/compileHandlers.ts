import * as R from 'ramda';

import { FAUST_COMPILER_ENDPOINT } from 'src/conf';
import type { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';
import { buildFaustWorkletNode, type FaustWorkletNode } from 'src/faustEditor/FaustAudioWorklet';
import { buildSoulWorkletNode } from 'src/faustEditor/SoulAudioWorklet';
import { faustEditorContextMap, get_faust_editor_connectables } from 'src/faustEditor';
import { updateConnectables } from 'src/patchNetwork/interface';
import type { ValueOf } from 'src/util';

const ctx = new AudioContext();

export const compileFaustInstance = async (
  faustCode: string,
  optimize: boolean,
  context: ValueOf<typeof faustEditorContextMap>
): Promise<FaustWorkletNode> => {
  const formData = new FormData();
  formData.append('code.faust', new Blob([faustCode], { type: 'text/plain' }));
  if (optimize) {
    formData.append('optimize', 'true');
  }

  const res = await fetch(`${FAUST_COMPILER_ENDPOINT}/compile`, { method: 'POST', body: formData });
  const moduleIdHeaderName = 'X-Faust-Module-ID';
  const moduleID = res.headers.get(moduleIdHeaderName);
  if (!moduleID) {
    throw new Error(`No \`${moduleIdHeaderName}\` header set in response from Faust compiler`);
  }

  if (!res.ok) {
    const errMsg = await res.text();
    throw errMsg;
  }

  const wasmInstanceArrayBuffer = await res.arrayBuffer();
  return buildFaustWorkletNode(ctx, wasmInstanceArrayBuffer, moduleID, context);
};

export const compileSoulInstance = async (
  code: string,
  _optimize: boolean,
  context: ValueOf<typeof faustEditorContextMap>
): Promise<DynamicCodeWorkletNode> => {
  const res = await fetch(`${FAUST_COMPILER_ENDPOINT}/soul/compile`, {
    method: 'POST',
    body: code,
  });
  const moduleIdHeaderName = 'X-Soul-Module-ID';
  const moduleID = res.headers.get(moduleIdHeaderName);
  if (!moduleID) {
    throw new Error(`No \`${moduleIdHeaderName}\` header set in response from Faust compiler`);
  }

  if (!res.ok) {
    const errMsg = await res.text();
    throw errMsg;
  }

  const wasmInstanceArrayBuffer = await res.arrayBuffer();
  return buildSoulWorkletNode(ctx, wasmInstanceArrayBuffer, moduleID, context);
};

type CodeCompiler = (
  code: string,
  optimize: boolean,
  context: ValueOf<typeof faustEditorContextMap>
) => Promise<DynamicCodeWorkletNode>;

interface MkCompileButtonClickHandlerArgs {
  setErrMessage: (errMsg: string) => void;
  vcId: string;
  analyzerNode: AnalyserNode;
  compiler?: CodeCompiler;
}

export const mkCompileButtonClickHandler =
  ({
    setErrMessage,
    vcId,
    analyzerNode,
    compiler = compileFaustInstance,
  }: MkCompileButtonClickHandlerArgs) =>
  async (): Promise<boolean> => {
    const context = faustEditorContextMap[vcId];
    let codeNode: DynamicCodeWorkletNode;
    try {
      const { editorContent: code, optimize } = context.reduxInfra.getState().faustEditor;
      codeNode = await compiler(code, optimize ?? false, context);
    } catch (err) {
      console.error(err);
      setErrMessage(`${err}`);
      return false;
    }
    setErrMessage('');

    if (!faustEditorContextMap[vcId]) {
      return false;
    }
    const settings = codeNode.getParamSettings(context.paramDefaultValues);

    codeNode.connect(analyzerNode);

    faustEditorContextMap[vcId].analyzerNode = analyzerNode;
    faustEditorContextMap[vcId].faustNode = codeNode;
    context.reduxInfra.dispatch(
      context.reduxInfra.actionCreators.faustEditor.SET_CACHED_INPUT_NAMES(
        settings.map(R.prop('label')) as string[]
      )
    );

    // Since we now have an audio node that we can connect to things, trigger a new audio connectables to be created
    const newConnectables = get_faust_editor_connectables(vcId);
    updateConnectables(vcId, newConnectables);

    context.reduxInfra.dispatch(
      context.reduxInfra.actionCreators.faustEditor.SET_FAUST_INSTANCE(codeNode, vcId)
    );
    return true;
  };

/**
 * Returns a function that stops the currently running Faust editor instance, setting Redux and `faustEditorContextMap`
 * to reflect this new state;
 */
export const mkStopInstanceHandler = (vcId: string) => () => {
  const context = faustEditorContextMap[vcId];
  context.reduxInfra.dispatch(
    context.reduxInfra.actionCreators.faustEditor.CLEAR_ACTIVE_INSTANCE()
  );

  // Disconnect the internal connection between the nodes so that the nodes can be garbage collected
  if (!context.faustNode) {
    throw new Error(
      `\`faustNode\` should have been set by now since the Faust editor is now being stopped for vcId ${vcId} but they haven't`
    );
  }
  context.faustNode.disconnect(context.analyzerNode);
  context.faustNode.shutdown();
  delete context.faustNode;

  context.paramDefaultValues = Object.fromEntries(
    Object.entries(context.overrideableParams).map(([address, param]) => [
      address,
      param.manualControl.offset.value,
    ])
  );

  // Create new audio connectables using a passthrough node
  updateConnectables(vcId, get_faust_editor_connectables(vcId));
  context.overrideableParams = {};
};
