import React from 'react';

import { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const EXCLUDED_TYPES: ParamSource['type'][] = ['base frequency multiplier'];

const ConfigureOutputWeight: React.FC<{
  operatorIx: number;
  state: ParamSource;
  onChange: (newState: ParamSource) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  synthID: string;
}> = ({ operatorIx, state, onChange, adsrs, onAdsrChange, synthID }) => (
  <div className='configure-output-weight' data-synth-id={synthID}>
    <ConfigureParamSource
      title={`Operator ${operatorIx} output weight`}
      state={state}
      onChange={onChange}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      excludedTypes={EXCLUDED_TYPES}
    />
  </div>
);

export default ConfigureOutputWeight;
