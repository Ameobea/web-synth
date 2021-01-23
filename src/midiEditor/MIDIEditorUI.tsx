import React from 'react';

import MIDIEditorControls from './MIDIEditorControls';

export const buildMIDIEditorUIDomId = (vcId: string) => `midi-editor-polysynth-controls_${vcId}`;

const MIDIEditorUI: React.FC<{
  engine: typeof import('src/engine');
  vcId: string;
}> = ({ engine, vcId }) => (
  <div id={buildMIDIEditorUIDomId(vcId)}>
    <MIDIEditorControls engine={engine} vcId={vcId} />
  </div>
);

export default MIDIEditorUI;
