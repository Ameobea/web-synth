import React from 'react';

import ConfigureParamSource, { ParamSource } from 'src/fmSynth/ConfigureParamSource';

const ConfigureModulationIndex: React.FC<{
  srcOperatorIx: number;
  dstOperatorIx: number;
  modulationIndices: ParamSource[][];
  onChange: (srcOperatorIx: number, dstOperatorIx: number, newModulationIndex: ParamSource) => void;
}> = ({ srcOperatorIx, dstOperatorIx, modulationIndices, onChange }) => (
  <div className='configure-modulation-index'>
    <ConfigureParamSource
      title='modulation index'
      state={modulationIndices[srcOperatorIx][dstOperatorIx]}
      onChange={newVal => onChange(srcOperatorIx, dstOperatorIx, newVal)}
      min={-30}
      max={30}
      excludedTypes={['base frequency multiplier']}
    />
  </div>
);

export default ConfigureModulationIndex;
