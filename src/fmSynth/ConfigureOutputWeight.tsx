import React from 'react';

import type { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource from 'src/fmSynth/ConfigureParamSource';
import type { ParamSource } from 'src/fmSynth/ParamSource';
import type { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const EXCLUDED_TYPES: ParamSource['type'][] = ['base frequency multiplier'];

interface ConfigureOutputWeightProps {
  operatorIx: number;
  state: ParamSource;
  onChange: (newState: ParamSource) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  synthID: string;
  vcId: string | undefined;
}

const ConfigureOutputWeight: React.FC<ConfigureOutputWeightProps> = ({
  operatorIx,
  state,
  onChange,
  adsrs,
  onAdsrChange,
  synthID,
  vcId,
}) => (
  <div className='configure-output-weight' data-synth-id={synthID}>
    <ConfigureParamSource
      title={`Operator ${operatorIx} output weight`}
      state={state}
      onChange={onChange}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      excludedTypes={EXCLUDED_TYPES}
      vcId={vcId}
    />
  </div>
);

export default ConfigureOutputWeight;
