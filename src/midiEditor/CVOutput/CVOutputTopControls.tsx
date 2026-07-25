import React from 'react';

import { logEvent } from 'src/eventAnalytics';
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
      onClick={() => {
        logEvent('midi-editor', 'add-instance');
        inst.uiManager.addMIDIEditorInstance();
      }}
      title='Add MIDI Editor Instance'
    />
    <MIDIEditorControlButton
      label='AO'
      onClick={() => {
        logEvent('midi-editor', 'add-cv-output');
        inst.addCVOutput();
      }}
      title='Add CV Output'
    />
  </div>
);
