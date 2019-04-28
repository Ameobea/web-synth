import React from 'react';
import { connect } from 'react-redux';

import PolySynthSettings from './controls/polysynth';
import { PolySynth } from './synth';
import './index.css';

interface AppProps {
  engine: typeof import('./engine');
  synths: PolySynth[];
}

const App: React.FunctionComponent<AppProps> = ({ synths }: AppProps) => (
  <PolySynthSettings synth={synths[0]} />
);

const mapStateToProps = ({ synths: { synths } }: { synths: { synths: PolySynth[] } }) => ({
  synths,
});

const EnhancedApp = connect(mapStateToProps)(App);

export default EnhancedApp;
