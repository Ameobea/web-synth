import * as React from 'react';
import { Fragment, useState } from 'react';
import * as R from 'ramda';

import PolySynthSettings from './controls/polysynth';
import ADSRControls, { ADSRValues, defaultAdsrEnvelope } from './controls/adsr';
import { SYNTHS } from './synth';

export default ({ engine }: { engine: typeof import('./engine') }) => {
  const [adsrEnvelope, setAdsrEnvelope] = useState(defaultAdsrEnvelope);

  return (
    <Fragment>
      <PolySynthSettings synth={SYNTHS[0]} />
      <ADSRControls
        value={adsrEnvelope}
        height={200}
        width={350}
        handleRadius={4}
        onChange={newEnvelope => {
          setAdsrEnvelope(newEnvelope);
          SYNTHS.forEach(synth => synth.setEnvelope(newEnvelope));
        }}
        style={{ marginTop: 1000 }}
      />
      <div style={{ marginTop: 1500 }}>a</div>
    </Fragment>
  );
};
