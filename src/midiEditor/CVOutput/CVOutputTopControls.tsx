import React from 'react';

import { MIDIEditorControlButton } from 'src/midiEditor/MIDIEditorControlButton';
import './CVOutputTopControls.css';
import { MIDIEditorInstance } from 'src/midiEditor';

interface CVOutputTopControlsProps {
  inst: MIDIEditorInstance;
}

export const CVOutputTopControls: React.FC<CVOutputTopControlsProps> = ({ inst }) => {
  const handleClick = () => inst.addCVOutput();

  return (
    <div className='cv-top-output-controls'>
      <MIDIEditorControlButton label='AO' onClick={handleClick} title='Add CV Output' />
    </div>
  );
};
