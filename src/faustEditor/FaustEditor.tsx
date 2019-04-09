import React, { Suspense, useState } from 'react';
import ace from 'ace-builds';
// tslint:disable-next-line:no-submodule-imports
import 'ace-builds/webpack-resolver';

ace.require('ace/theme/twilight');

const ReactAce = React.lazy(() => import('react-ace'));

interface FaustEditorProps {
  onChange: (newState: string) => void;
}

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

          const res = await fetch('http://localhost:4565/compile', {
            method: 'POST',
            // headers: { 'Content-Type': 'multipart/form-data' },
            body: formData,
          });
          const blob = await res.blob();

          // Convert the blob into an `ArrayBuffer` and then compile that into a WebAssembly module
          const fileReader = new FileReader();
          fileReader.onload = async evt => {
            const arrayBuffer: ArrayBuffer = evt.target!.result;
            const compiledModule = await WebAssembly.compile(arrayBuffer);
            const wasmInstance = new WebAssembly.Instance(compiledModule);
            console.log(wasmInstance);
          };
          fileReader.readAsArrayBuffer(blob);
        }}
      >
        Compile
      </button>
    </Suspense>
  );
};

export default mkFaustEditor;
