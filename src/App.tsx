import * as React from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';

import DuoSynthSettings from './controls/duosynth';
import { Tone } from './chords';

const NAME = 'Test Synth';

export default () => {
  return <DuoSynthSettings />;
};
