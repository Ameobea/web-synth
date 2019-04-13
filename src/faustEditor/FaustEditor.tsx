import React, { Suspense, useState } from 'react';
import ace from 'ace-builds';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';
// tslint:disable-next-line:no-submodule-imports
import 'ace-builds/webpack-resolver';

ace.require('ace/theme/twilight');

const ReactAce = React.lazy(() => import('react-ace'));

interface FaustEditorProps {
  onChange: (newState: string) => void;
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

const getMicrophoneStream = (): Promise<MediaStream> =>
  new Promise((fulfill, reject) => {
    if (navigator.getUserMedia) {
      navigator.getUserMedia({ audio: true }, fulfill, reject);
    }
    fulfill(navigator.mediaDevices.getUserMedia({ audio: true }));
  });

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
};

interface BaseUiDef {
  type: string;
  label: string;
  address: string;
}

type UiDefExtra = { min: number; max: number; step: number; init: number };

type UiDef = BaseUiDef & UiDefExtra;

type UiGroup = { items: UiDef[]; label: string; type: string };

const buildControlPanelField = (def: UiDef): {} | null => {
  const mapper = {
    hslider: ({ address, min, max, init, step }: UiDef) => ({
      type: 'range',
      label: address,
      min,
      max,
      initial: init,
      step,
    }),
  }[def.type];

  if (!mapper) {
    console.warn(`Unable to build UI field of type ${def.type}`);
    return null;
  }

  return mapper(def);
};

const mapUiGroupToControlPanelFields = (group: UiGroup): {}[] =>
  group.items.map(buildControlPanelField).filter((group): group is {} => !!group);

const buildControlPanel = (
  uiDef: UiGroup[],
  setParamValue: FaustModuleInstance['setParamValue']
) => {
  const controlPanelFieldDefinitions = uiDef.flatMap(mapUiGroupToControlPanelFields);

  if (R.isEmpty(controlPanelFieldDefinitions)) {
    return null;
  }

  return (
    <ControlPanel
      draggable
      theme='dark'
      position='top-right'
      settings={controlPanelFieldDefinitions}
      onChange={setParamValue}
    />
  );
};

const mkFaustEditor = (initialContent: string = '') => ({ onChange }: FaustEditorProps) => {
  const [value, setValue] = useState(initialContent);
  const [compileErrMsg, setCompileErrMsg] = useState('');
  const [controlPanel, setControlPanel] = useState<React.ReactNode>(null);

  const handleCompileButtonClick = async () => {
    const formData = new FormData();
    formData.append('code.faust', new Blob([value], { type: 'text/plain' }));

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
    console.log(wasmInstance);

    // Create a faust module instance (which extends `ScriptProcessorNode`) from the Wasm module
    const converterInstance = new FaustWasm2ScriptProcessor('name', dspDefProps, {
      debug: false,
    });
    const audioContext = new AudioContext();
    const faustInstance: FaustModuleInstance = await converterInstance.getNode(
      wasmInstance,
      audioContext,
      1024
    );

    const microphoneStream = await getMicrophoneStream();
    const source = audioContext.createMediaStreamSource(microphoneStream);

    source.connect(faustInstance);
    faustInstance.connect(audioContext.destination);

    setControlPanel(buildControlPanel(dspDefProps.ui, faustInstance.setParamValue));

    console.log({ dspDefProps });
  };

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <div style={styles.root}>
        <ReactAce
          theme='twilight'
          mode='text'
          showPrintMargin={false}
          onChange={newValue => {
            onChange(newValue);
            setValue(newValue);
          }}
          name='ace-editor'
          width='40vw'
          value={value}
        />

        <div style={styles.errorConsole}>{compileErrMsg}</div>
      </div>

      <button onClick={handleCompileButtonClick}>Compile</button>
      {controlPanel}
    </Suspense>
  );
};

export default mkFaustEditor;
