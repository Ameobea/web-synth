import React from 'react';

import type { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import { UISelection } from 'src/fmSynth/FMSynthUI';

export const ModulationMatrix: React.FC<{
  selectedUI: UISelection | null;
  selectedOperatorIx: number | null;
  onOperatorSelected: (newSelectedOperatorIx: number) => void;
  onModulationIndexSelected: (srcOperatorIx: number, dstOperatorIx: number) => void;
  modulationIndices: ParamSource[][];
  outputWeights: number[];
}> = ({
  selectedUI,
  selectedOperatorIx,
  onOperatorSelected,
  onModulationIndexSelected,
  modulationIndices,
  outputWeights,
}) => (
  <div className='modulation-matrix'>
    {modulationIndices.map((row, srcOperatorIx) => (
      <div className='operator-row' key={srcOperatorIx}>
        <div
          className={
            'operator-select' + (selectedOperatorIx === srcOperatorIx ? ' operator-selected' : '')
          }
          onClick={() => {
            onOperatorSelected(srcOperatorIx);
          }}
        />
        {row.map((val, dstOperatorIx) => (
          <div
            data-src-operator-ix={srcOperatorIx}
            data-dst-operator-ix={dstOperatorIx}
            data-active={
              selectedUI?.type === 'modulationIndex' &&
              selectedUI.srcOperatorIx === srcOperatorIx &&
              selectedUI.dstOperatorIx === dstOperatorIx
                ? 'true'
                : 'false'
            }
            className='operator-square'
            key={dstOperatorIx}
            onClick={() => onModulationIndexSelected(srcOperatorIx, dstOperatorIx)}
          >
            {val.type === 'constant'
              ? Math.abs(val.value) < 0.01
                ? null
                : val.value.toFixed(2)
              : '-'}
          </div>
        ))}
        <div
          data-operator-ix={srcOperatorIx}
          key='output'
          className='operator-square output-weight'
        >
          {Math.abs(outputWeights[srcOperatorIx]) < 0.01
            ? null
            : outputWeights[srcOperatorIx].toFixed(2)}
        </div>
      </div>
    ))}
  </div>
);

export default ModulationMatrix;
