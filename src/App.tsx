import * as React from 'react';
import { connect } from 'react-redux';
import { Fragment, useState } from 'react';
import * as R from 'ramda';

import PolySynthSettings from './controls/polysynth';
import ADSRControls, { ADSRValues, defaultAdsrEnvelope } from './controls/adsr';
import { PolySynth } from './synth';

type AppProps = { engine: typeof import('./engine'); synths: PolySynth[] };

const App = ({ engine, synths }: AppProps) => {
  const [adsrEnvelope, setAdsrEnvelope] = useState(defaultAdsrEnvelope);
  console.log('synths: ', synths);

  return (
    <Fragment>
      <PolySynthSettings synth={synths[0]} />
      <ADSRControls
        value={adsrEnvelope}
        height={200}
        width={350}
        handleRadius={4}
        onChange={newEnvelope => {
          setAdsrEnvelope(newEnvelope);
          synths.forEach(synth => synth.setEnvelope(newEnvelope));
        }}
        style={{ marginTop: 1000 }}
      />
      <div style={{ marginTop: 1500 }}>a</div>
    </Fragment>
  );
};

const mapStateToProps = ({ synths: { synths } }) => ({ synths });

const EnhancedApp = connect(mapStateToProps)(App);

export default EnhancedApp;
