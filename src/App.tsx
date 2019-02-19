import * as React from 'react';
import { Fragment, useState } from 'react';
import * as R from 'ramda';

import PolySynthSettings from './controls/polysynth';
import ADSRControls, { ADSRValues } from './controls/adsr';

const getInitialAdsrState = () => ({
  attack: { pos: 0.2, magnitude: 0.8 },
  decay: { pos: 0.4, magnitude: 0.56 },
  sustain: { pos: 0.75, magnitude: 0.56 },
  release: { pos: 0.9, magnitude: 0.2 },
});

const serializeADSRState = (state: ADSRValues): void => {
  // TODO: Send to
};

export default ({ wasm }: { wasm: typeof import('./engine') }) => {
  const [adsrState, setAdsrState] = useState(getInitialAdsrState());

  return (
    <Fragment>
      <PolySynthSettings />
      <ADSRControls
        value={adsrState}
        height={580}
        width={800}
        onChange={newState => {
          setAdsrState(newState);
          const serializedState = serializeADSRState(newState);
          // TODO: Callback into Wasm
          // wasm.set_adsr_state(serializedState);
        }}
        style={{ marginTop: 1000 }}
      />
    </Fragment>
  );
};
