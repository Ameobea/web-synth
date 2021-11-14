import React, { useCallback } from 'react';

import { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import HelpIcon from 'src/misc/HelpIcon';

const EXCLUDED_TYPES: ParamSource['type'][] = ['base frequency multiplier'];
const TITLE = (
  <>
    modulation index <HelpIcon link='modulation-index' size={14} color='rgb(161, 161, 161)' />
  </>
);

const ConfigureModulationIndex: React.FC<{
  srcOperatorIx: number;
  dstOperatorIx: number;
  modulationIndices: ParamSource[][];
  onChange: (srcOperatorIx: number, dstOperatorIx: number, newModulationIndex: ParamSource) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  synthID: string;
}> = ({
  srcOperatorIx,
  dstOperatorIx,
  modulationIndices,
  onChange,
  adsrs,
  onAdsrChange,
  synthID,
}) => (
  <div className='configure-modulation-index' data-synth-id={synthID}>
    <ConfigureParamSource
      title={TITLE}
      state={modulationIndices[srcOperatorIx][dstOperatorIx]}
      onChange={useCallback(
        newVal => onChange(srcOperatorIx, dstOperatorIx, newVal),
        [dstOperatorIx, onChange, srcOperatorIx]
      )}
      min={-30}
      max={30}
      excludedTypes={EXCLUDED_TYPES}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
    />
  </div>
);

export default ConfigureModulationIndex;
