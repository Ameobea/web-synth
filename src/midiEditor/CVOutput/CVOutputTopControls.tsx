import React from 'react';

import { MIDIEditorControlButton } from 'src/midiEditor/MIDIEditorControlButton';
import './CVOutputTopControls.css';
import type { MIDIEditorInstance } from 'src/midiEditor';

interface CVOutputTopControlsProps {
  inst: MIDIEditorInstance;
}

export const CVOutputTopControls: React.FC<CVOutputTopControlsProps> = ({ inst }) => (
  <div className='cv-top-output-controls'>
    <MIDIEditorControlButton
      label='AE'
      onClick={() => inst.uiManager.addMIDIEditorInstance()}
      title='Add MIDI Editor Instance'
    />
    <MIDIEditorControlButton label='AO' onClick={() => inst.addCVOutput()} title='Add CV Output' />
  </div>
);
