import React, { useState } from 'react';

import BasicModal from 'src/misc/BasicModal';
import { ModalCompProps } from 'src/controls/Modal';

const SavePresetModal: React.FC<ModalCompProps<{
  title: string;
  description: string;
}>> = ({ onCancel, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  return (
    <BasicModal>
      <h2>Save Preset</h2>
      <p>
        Title
        <input type='text' value={title} onChange={evt => setTitle(evt.target.value)} />
      </p>
      Description
      <textarea value={description} onChange={evt => setDescription(evt.target.value)} />
      <button onClick={onCancel}>Cancel</button>
      <button disabled={!title || !description} onClick={() => onSubmit({ title, description })}>
        Save
      </button>
    </BasicModal>
  );
};

export default SavePresetModal;
