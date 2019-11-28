import React from 'react';
import { connect } from 'react-redux';

import PolySynthControls from 'src/controls/polysynth';
import { ReduxStore } from 'src/redux';
import '../index.css'; // hmm...

export const buildMIDIEditorUIDomId = (vcId: string) => `midi-editor-polysynth-controls_${vcId}`;

const mapStateToProps = ({ synths: { synths } }: ReduxStore) => ({ synths });

const MIDIEditorUI: React.FC<{ engine: typeof import('src/engine'); vcId: string } & ReturnType<
  typeof mapStateToProps
>> = ({ synths, engine, vcId }) => (
  <div id={buildMIDIEditorUIDomId(vcId)}>
    <PolySynthControls engine={engine} synth={synths[0]} />
  </div>
);

const EnhancedMIDIEditorUI = connect(mapStateToProps)(MIDIEditorUI);

export default EnhancedMIDIEditorUI;
