import * as React from 'react';
import * as R from 'ramda';

import PolySynthSettings_ from './controls/polysynth';

const PolySynthSettings = PolySynthSettings_ as any;

export default ({ loadComp }) => {
  return <PolySynthSettings loadComp={loadComp} />;
};
