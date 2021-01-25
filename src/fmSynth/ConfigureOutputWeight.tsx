import React from 'react';
import { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';

import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const ConfigureOutputWeight: React.FC<{
  operatorIx: number;
  state: ParamSource;
  onChange: (newState: ParamSource) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
}> = ({ operatorIx, state, onChange, adsrs, onAdsrChange }) => (
  <div className='configure-output-weight'>
    <ConfigureParamSource
      title={`Operator ${operatorIx} output weight`}
      state={state}
      onChange={onChange}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      excludedTypes={['base frequency multiplier']}
    />
  </div>
);

export default ConfigureOutputWeight;
