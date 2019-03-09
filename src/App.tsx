import React, { Fragment, useState } from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';

import PolySynthSettings from './controls/polysynth';
import ADSRControls, { ADSRValues, defaultAdsrEnvelope } from './controls/adsr';
import { PolySynth } from './synth';
import './index.css';

interface AppProps {
  engine: typeof import('./engine');
  synths: PolySynth[];
}

const App = ({ engine, synths }: AppProps) => <PolySynthSettings synth={synths[0]} />;

const mapStateToProps = ({ synths: { synths } }: { synths: { synths: PolySynth[] } }) => ({
  synths,
});

const EnhancedApp = connect(mapStateToProps)(App);

export default EnhancedApp;
