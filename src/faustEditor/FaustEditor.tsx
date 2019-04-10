import React, { Suspense, useState } from 'react';
import ace from 'ace-builds';
// tslint:disable-next-line:no-submodule-imports
import 'ace-builds/webpack-resolver';

ace.require('ace/theme/twilight');

const ReactAce = React.lazy(() => import('react-ace'));

interface FaustEditorProps {
  onChange: (newState: string) => void;
}

const { WebAssembly } = window as any;

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

const mkFaustEditor = (initialContent: string = '') => ({ onChange }: FaustEditorProps) => {
  const [value, setValue] = useState(initialContent);

  return (
    <Suspense fallback={<span>Loading...</span>}>
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

      <button
        onClick={async () => {
          const formData = new FormData();
          formData.append('code.faust', new Blob([value], { type: 'text/plain' }));

          const res = await fetch('https://faust.ameo.design/compile', {
            method: 'POST',
            // headers: { 'Content-Type': 'multipart/form-data' },
            body: formData,
          });

          const arrayBuffer = await res.arrayBuffer();

          const compiledModule = await WebAssembly.compile(arrayBuffer);
          const wasmInstance = new WebAssembly.Instance(compiledModule, importObject);
          console.log(wasmInstance);

          const dspDefProps = {
            name: 'hello.faust',
            filename: 'hello.faust',
            version: '2.17.6',
            compile_options: '-scal -ftz 0',
            library_list: [
              '/usr/local/share/faust/stdfaust.lib',
              '/usr/local/share/faust/misceffects.lib',
              '/usr/local/share/faust/maths.lib',
              '/usr/local/share/faust/delays.lib',
            ],
            include_pathnames: [
              '/usr/local/share/faust',
              '/usr/local/share/faust',
              '/usr/share/faust',
              '.',
              '/home/casey/web-synth/faust-compiler',
            ],
            size: '524304',
            inputs: '1',
            outputs: '1',
            meta: [
              { 'delays.lib/name': 'Faust Delay Library' },
              { 'delays.lib/version': '0.1' },
              { filename: 'hello.faust' },
              { 'maths.lib/author': 'GRAME' },
              { 'maths.lib/copyright': 'GRAME' },
              { 'maths.lib/license': 'LGPL with exception' },
              { 'maths.lib/name': 'Faust Math Library' },
              { 'maths.lib/version': '2.1' },
              { 'misceffects.lib/name': 'Faust Math Library' },
              { 'misceffects.lib/version': '2.0' },
              { name: 'hello.faust' },
            ],
            ui: [{ type: 'vgroup', label: 'hello.faust', items: [] }],
          }; // TODO: Get this from the API as well

          // Create a `ScriptProcessorNode` from the Wasm module
          const converterInstance = new FaustWasm2ScriptProcessor('name', dspDefProps, {
            debug: false,
          });
          const audioContext = new AudioContext();
          const scriptNode: ScriptProcessorNode = await converterInstance.getNode(
            wasmInstance,
            audioContext,
            1024
          );
          console.log('Created node: ', scriptNode);

          const microphoneStream = await getMicrophoneStream();
          const source = audioContext.createMediaStreamSource(microphoneStream);
          console.log(source.connect);

          source.connect(scriptNode);
          scriptNode.connect(audioContext.destination);
        }}
      >
        Compile
      </button>
    </Suspense>
  );
};

export default mkFaustEditor;
