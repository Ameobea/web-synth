import React from 'react';

import './FSAccessDialog.css';

const FSAccessDialog: React.FC<{
  onSubmit: (val: void) => void;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => (
  <div className='fs-access-dialog'>
    <h1>Grant Filesystem Access</h1>
    <p>
      In order to access files stored on your computer to load samples, save/load compositions,
      export audio, and other tasks, you must grant permission to access a directory on your
      computer.{' '}
    </p>
    <p>
      If you&apos;ve previously selected a data directory for this application to use, pick that
      same directory now. Otherwise, select an empty directory to be used as the data directory.
    </p>

    <div className='buttons-container'>
      <button onClick={() => onCancel()}>Cancel</button>
      <button onClick={() => onSubmit()}>Choose Directory</button>
    </div>
  </div>
);

export default FSAccessDialog;
