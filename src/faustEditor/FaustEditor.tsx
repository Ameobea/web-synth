import React, { Suspense } from 'react';
import ace from 'ace-builds';
// tslint:disable-next-line:no-submodule-imports
import 'ace-builds/webpack-resolver';

ace.require('ace/theme/twilight');

const ReactAce = React.lazy(() => import('react-ace'));

interface FaustEditorProps {
  onChange: (newState: string) => void;
}

const mkFaustEditor = (initialContent: string = '') => ({ onChange }: FaustEditorProps) => (
  <Suspense fallback={<span>Loading...</span>}>
    <ReactAce
      theme='twilight'
      mode='text'
      showPrintMargin={false}
      onChange={onChange}
      name='ace-editor'
      width='40vw'
      value={initialContent}
    />
  </Suspense>
);

export default mkFaustEditor;
