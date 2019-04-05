import React, { useState, Suspense } from 'react';
import ace from 'ace-builds';
import 'ace-builds/webpack-resolver';

ace.require('ace/theme/twilight');

const ReactAce = React.lazy(() => import('react-ace'));

const FaustEditor = () => {
  const [editorState, setEditorState] = useState('');

  return (
    <Suspense fallback={<span>Loading...</span>}>
      <ReactAce
        theme='twilight'
        mode='text'
        showPrintMargin={false}
        onChange={console.log}
        name='ace-editor'
        width='40vw'
      />
    </Suspense>
  );
};

export default FaustEditor;
