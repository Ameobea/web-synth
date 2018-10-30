import * as React from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';

import PolySynthSettings from './controls/polysynth';

const NAME = 'Test Synth';

export default () => {
  return <PolySynthSettings />;
};
