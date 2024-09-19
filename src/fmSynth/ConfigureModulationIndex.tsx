import React, { useCallback } from 'react';

import type { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
import ConfigureParamSource from 'src/fmSynth/ConfigureParamSource';
import type { ParamSource } from 'src/fmSynth/ParamSource';
import type { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
import HelpIcon from 'src/misc/HelpIcon';

const EXCLUDED_TYPES: ParamSource['type'][] = ['base frequency multiplier'];
const TITLE = (
  <>
    modulation index <HelpIcon link='modulation-index' size={14} color='rgb(161, 161, 161)' />
  </>
);

interface ConfigureModulationIndexProps {
  srcOperatorIx: number;
  dstOperatorIx: number;
  modulationIndices: ParamSource[][];
  onChange: (srcOperatorIx: number, dstOperatorIx: number, newModulationIndex: ParamSource) => void;
  adsrs: AdsrParams[];
  onAdsrChange: AdsrChangeHandler;
  synthID: string;
  vcId: string | undefined;
}

const ConfigureModulationIndex: React.FC<ConfigureModulationIndexProps> = ({
  srcOperatorIx,
  dstOperatorIx,
  modulationIndices,
  onChange,
  adsrs,
  onAdsrChange,
  synthID,
  vcId,
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
      defaultVal={0}
      excludedTypes={EXCLUDED_TYPES}
      adsrs={adsrs}
      onAdsrChange={onAdsrChange}
      vcId={vcId}
    />
  </div>
);

export default ConfigureModulationIndex;
