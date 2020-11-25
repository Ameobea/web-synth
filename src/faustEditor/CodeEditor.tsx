import React from 'react';
import ReactAce from 'react-ace';
import 'ace-builds/src-min-noconflict/theme-twilight';

const CodeEditor: React.FC<{
  value: string;
  onChange: (newContent: string) => void;
}> = ({ value, onChange }) => (
  <ReactAce
    theme='twilight'
    mode='text'
    showPrintMargin={false}
    onChange={onChange}
    name='ace-editor'
    width='calc(50vw - 40px)'
    value={value}
    style={{ border: '1px solid #555' }}
  />
);

export default CodeEditor;
