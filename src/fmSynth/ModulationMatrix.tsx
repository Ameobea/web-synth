import React, { useState } from 'react';

import type { OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import type { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import type { UISelection } from 'src/fmSynth/FMSynthUI';

export const ModulationMatrix: React.FC<{
  selectedUI: UISelection | null;
  selectedOperatorIx: number | null;
  onOperatorSelected: (newSelectedOperatorIx: number) => void;
  onModulationIndexSelected: (srcOperatorIx: number, dstOperatorIx: number) => void;
  modulationIndices: ParamSource[][];
  operatorConfigs: OperatorConfig[];
  outputWeights: number[];
}> = ({
  selectedUI,
  selectedOperatorIx,
  onOperatorSelected,
  onModulationIndexSelected,
  modulationIndices,
  operatorConfigs,
  outputWeights,
}) => {
  const [hoveredRowIx, setHoveredRowIx] = useState<number | null>(null);
  const [hoveredColIx, setHoveredColIx] = useState<number | null>(null);

  return (
    <div
      className='modulation-matrix'
      onMouseLeave={() => {
        setHoveredRowIx(null);
        setHoveredColIx(null);
      }}
    >
      {modulationIndices.map((row, srcOperatorIx) => (
        <div
          data-hovered={hoveredRowIx === srcOperatorIx ? 'true' : 'false'}
          className={'operator-row'}
          key={srcOperatorIx}
        >
          <div
            className={
              'operator-select' + (selectedOperatorIx === srcOperatorIx ? ' operator-selected' : '')
            }
            onClick={() => {
              onOperatorSelected(srcOperatorIx);
            }}
            onMouseEnter={() => setHoveredRowIx(srcOperatorIx)}
          >
            {(operatorConfigs[srcOperatorIx].type === 'sine oscillator' ||
              operatorConfigs[srcOperatorIx].type === 'exponential oscillator') &&
            operatorConfigs[srcOperatorIx].frequency.type === 'base frequency multiplier'
              ? operatorConfigs[srcOperatorIx].frequency.multiplier.toFixed(3)
              : '-'}
          </div>
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
              data-hovered={hoveredColIx === dstOperatorIx ? 'true' : 'false'}
              className='operator-square'
              key={dstOperatorIx}
              onClick={() => onModulationIndexSelected(srcOperatorIx, dstOperatorIx)}
              onMouseEnter={() => {
                setHoveredRowIx(srcOperatorIx);
                setHoveredColIx(dstOperatorIx);
              }}
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
};

export default ModulationMatrix;
