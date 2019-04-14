import React, { Suspense, useState } from 'react';
import { connect } from 'react-redux';
import ace from 'ace-builds';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';
// tslint:disable-next-line:no-submodule-imports
import 'ace-builds/webpack-resolver';

import { State as ReduxState } from '../redux';
import { actionCreators } from '../redux/reducers/faustEditor';
import buildControlPanel from './uiBuilder';
import buildInstance from './buildInstance';

const { setActiveInstance, clearActiveInstance, setEditorContent } = actionCreators;

ace.require('ace/theme/twilight');

const ReactAce = React.lazy(() => import('react-ace'));

export interface FaustModuleInstance extends ScriptProcessorNode {
  getParamValue: (path: string) => number;
  setParamValue: (path: string, val: number) => void;
}

const { WebAssembly } = window as any;

const FAUST_COMPILER_ENDPOINT =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:4565/compile'
    : 'https://faust.ameo.design/compile';

// Stolen from Faust code
const importObject = {
  env: {
    memoryBase: 0,
    tableBase: 0,
    _abs: Math.abs,

    // Float version
    _acosf: Math.acos,
    _asinf: Math.asin,
    _atanf: Math.atan,
    _atan2f: Math.atan2,
    _ceilf: Math.ceil,
    _cosf: Math.cos,
    _expf: Math.exp,
    _floorf: Math.floor,
    _fmodf: (x: number, y: number) => x % y,
    _logf: Math.log,
    _log10f: Math.log10,
    _max_f: Math.max,
    _min_f: Math.min,
    _remainderf: (x: number, y: number) => x - Math.round(x / y) * y,
    _powf: Math.pow,
    _roundf: Math.fround,
    _sinf: Math.sin,
    _sqrtf: Math.sqrt,
    _tanf: Math.tan,
    _acoshf: Math.acosh,
    _asinhf: Math.asinh,
    _atanhf: Math.atanh,
    _coshf: Math.cosh,
    _sinhf: Math.sinh,
    _tanhf: Math.tanh,

    // Double version
    _acos: Math.acos,
    _asin: Math.asin,
    _atan: Math.atan,
    _atan2: Math.atan2,
    _ceil: Math.ceil,
    _cos: Math.cos,
    _exp: Math.exp,
    _floor: Math.floor,
    _fmod: (x: number, y: number) => x % y,
    _log: Math.log,
    _log10: Math.log10,
    _max_: Math.max,
    _min_: Math.min,
    _remainder: (x: number, y: number) => x - Math.round(x / y) * y,
    _pow: Math.pow,
    _round: Math.fround,
    _sin: Math.sin,
    _sqrt: Math.sqrt,
    _tan: Math.tan,
    _acosh: Math.acosh,
    _asinh: Math.asinh,
    _atanh: Math.atanh,
    _cosh: Math.cosh,
    _sinh: Math.sinh,
    _tanh: Math.tanh,

    table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
  },
};

const styles: { [key: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'row',
  },
  codeEditor: {
    display: 'flex',
    flex: 1,
  },
  errorConsole: {
    display: 'flex',
    flex: 1,
    color: '#eee',
    marginLeft: 10,
    fontFamily: "'Oxygen Mono'",
    maxHeight: 600,
  },
  buttonsWrapper: {
    display: 'flex',
    flexDirection: 'row',
    padding: 8,
  },
  editor: {
    border: '1px solid #555',
  },
};

type StateProps = Pick<ReduxState['faustEditor'], 'instance' | 'controlPanel' | 'editorContent'>;

const mapDispatchToProps = { setActiveInstance, clearActiveInstance, setEditorContent };

type DispatchProps = typeof mapDispatchToProps;

type FaustEditorProps = StateProps & DispatchProps & { children: undefined };

const mapStateToProps = ({ faustEditor }: ReduxState) => ({
  instance: faustEditor.instance,
  controlPanel: faustEditor.controlPanel,
  editorContent: faustEditor.editorContent,
});

const enhance = connect<StateProps, DispatchProps, {}>(
  mapStateToProps,
  mapDispatchToProps
);

const FaustEditor: React.FunctionComponent<{}> = ({
  instance,
  controlPanel,
  editorContent,
  setActiveInstance,
  clearActiveInstance,
  setEditorContent,
}: FaustEditorProps) => {
  const [compileErrMsg, setCompileErrMsg] = useState('');

  // TODO: Memoize/optimize.  Shouldn't have to re-build this whole thing every time the editor
  // text changes.
  const handleCompileButtonClick = async () => {
    const formData = new FormData();
    formData.append('code.faust', new Blob([editorContent], { type: 'text/plain' }));

    const res = await fetch(FAUST_COMPILER_ENDPOINT, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errMsg = await res.text();
      setCompileErrMsg(errMsg);
      return;
    }

    // The JSON definition for the module is set as a HTTP header, which we must extract and parse.
    const jsonModuleDefString = res.headers.get('X-Json-Module-Definition');
    if (!jsonModuleDefString) {
      setCompileErrMsg("The `X-Json-Module-Definition` header wasn't set on the response.");
      return;
    }

    setCompileErrMsg('');
    const dspDefProps = JSON.parse(jsonModuleDefString);

    const arrayBuffer = await res.arrayBuffer();

    const compiledModule = await WebAssembly.compile(arrayBuffer);
    const wasmInstance = new WebAssembly.Instance(compiledModule, importObject);

    const faustInstance = await buildInstance(wasmInstance, dspDefProps);
    setActiveInstance(faustInstance, dspDefProps);
  };

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <div style={styles.root}>
        <ReactAce
          theme='twilight'
          mode='text'
          showPrintMargin={false}
          onChange={newValue => setEditorContent(newValue)}
          name='ace-editor'
          width='40vw'
          value={editorContent}
          style={styles.editor}
        />

        <div style={styles.errorConsole}>{compileErrMsg}</div>
      </div>

      <div style={styles.buttonsWrapper}>
        <button onClick={handleCompileButtonClick}>Compile</button>
        {instance ? <button onClick={clearActiveInstance}>Stop</button> : null}
      </div>
      {controlPanel}
    </Suspense>
  );
};

const EnhancedFaustEditor = enhance(FaustEditor);

export default EnhancedFaustEditor;
