import React from 'react';
import { connect } from 'react-redux';

import PolySynthControls from './controls/polysynth';
import { PolySynth } from './synth';
import './index.css';
import { ReduxStore } from './redux';

const mapStateToProps = ({ synths: { synths } }: ReduxStore) => ({ synths });

const App: React.FC<{ engine: typeof import('./engine') } & ReturnType<typeof mapStateToProps>> = ({
  synths,
  engine,
}) => <PolySynthControls engine={engine} synth={synths[0]} />;

const EnhancedApp = connect(mapStateToProps)(App);

export default EnhancedApp;
