import React from 'react';

import { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const ConfigureModulationIndex: React.FC<{
  srcOperatorIx: number;
  dstOperatorIx: number;
  modulationIndices: ParamSource[][];
  onChange: (srcOperatorIx: number, dstOperatorIx: number, newModulationIndex: ParamSource) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
}> = ({ srcOperatorIx, dstOperatorIx, modulationIndices, onChange, adsrs, onAdsrChange }) => (
  <div className='configure-modulation-index'>
    <ConfigureParamSource
      title='modulation index'
      state={modulationIndices[srcOperatorIx][dstOperatorIx]}
      onChange={newVal => onChange(srcOperatorIx, dstOperatorIx, newVal)}
      min={-30}
      max={30}
      excludedTypes={['base frequency multiplier']}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
    />
  </div>
);

export default ConfigureModulationIndex;
