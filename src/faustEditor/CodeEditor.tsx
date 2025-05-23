import React from 'react';
import ReactAce from 'react-ace';

// Need to import ace first, so prevent import sorting
// prettier-ignore
import 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-min-noconflict/theme-twilight';
import 'ace-builds/src-noconflict/mode-javascript';

interface CodeEditorProps {
  value: string;
  onChange: (newContent: string) => void;
  mode?: string;
  height?: number;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, mode, height }) => (
  <ReactAce
    theme='twilight'
    mode={mode ?? 'text'}
    showPrintMargin={false}
    onChange={onChange}
    name='ace-editor'
    width='calc(50vw - 40px)'
    value={value}
    style={{ border: '1px solid #555' }}
    setOptions={{ useWorker: false }}
    height={`${height ?? '500px'}`}
  />
);

export default CodeEditor;
