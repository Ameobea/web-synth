import React from 'react';
import { connect } from 'react-redux';

import PolySynthControls from './controls/polysynth';
import './index.css';
import { ReduxStore } from './redux';

export const MIDI_EDITOR_CONTROLS_ID = 'midi-editor-polysynth-controls' as const;

const mapStateToProps = ({ synths: { synths } }: ReduxStore) => ({ synths });

const App: React.FC<{ engine: typeof import('./engine') } & ReturnType<typeof mapStateToProps>> = ({
  synths,
  engine,
}) => (
  <div id={MIDI_EDITOR_CONTROLS_ID}>
    <PolySynthControls engine={engine} synth={synths[0]} />
  </div>
);

const EnhancedApp = connect(mapStateToProps)(App);

export default EnhancedApp;
