import React, { useState } from 'react';

import type { OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import type { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import type { UISelection } from 'src/fmSynth/FMSynthUI';

const formatOperatorConfig = (config: OperatorConfig) => {
  if (
    (config.type === 'sine oscillator' || config.type === 'exponential oscillator') &&
    config.frequency.type === 'base frequency multiplier'
  ) {
    return config.frequency.multiplier.toFixed(3);
  }

  return '-';
};

const formatParamSource = (param: ParamSource): React.ReactNode => {
  if (param.type === 'constant') {
    return Math.abs(param.value) < 0.01 ? null : param.value.toFixed(2);
  } else if (param.type === 'adsr') {
    return (
      <span className='adsr-param'>
        ADSR {param['adsr index']}
        <br />
        {param.shift.toPrecision(3)} <br />
        {(param.shift + param.scale).toPrecision(3)}
      </span>
    );
  } else if (param.type === 'base frequency multiplier') {
    return (
      <>
        Base Freq
        <br />X<br />
        {param.multiplier.toFixed(3)}
      </>
    );
  } else {
    return '-';
  }
};

export const ModulationMatrix: React.FC<{
  selectedUI: UISelection | null;
  selectedOperatorIx: number | null;
  onOperatorSelected: (newSelectedOperatorIx: number) => void;
  resetModulationIndex: (srcOperatorIx: number, dstOperatorIx: number) => void;
  onModulationIndexSelected: (srcOperatorIx: number, dstOperatorIx: number) => void;
  modulationIndices: ParamSource[][];
  operatorConfigs: OperatorConfig[];
  outputWeights: number[];
}> = ({
  selectedUI,
  selectedOperatorIx,
  onOperatorSelected,
  resetModulationIndex,
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
        <div className={'operator-row'} key={srcOperatorIx}>
          <div
            data-hovered={hoveredColIx === srcOperatorIx ? 'true' : 'false'}
            className={
              'operator-select' + (selectedOperatorIx === srcOperatorIx ? ' operator-selected' : '')
            }
            onClick={() => {
              onOperatorSelected(srcOperatorIx);
            }}
            onMouseEnter={() => setHoveredRowIx(srcOperatorIx)}
          >
            {formatOperatorConfig(operatorConfigs[srcOperatorIx])}
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
              className='operator-square'
              key={dstOperatorIx}
              onClick={() => onModulationIndexSelected(srcOperatorIx, dstOperatorIx)}
              onDoubleClick={() => {
                if (val.type === 'constant') {
                  resetModulationIndex(srcOperatorIx, dstOperatorIx);
                }
              }}
              onMouseEnter={() => {
                setHoveredRowIx(srcOperatorIx);
                setHoveredColIx(dstOperatorIx);
              }}
            >
              {formatParamSource(val)}
            </div>
          ))}
          <div
            data-operator-ix={srcOperatorIx}
            key='output'
            className='operator-square output-weight'
          >
            <div
              className='operator-weight-lens'
              style={{
                backgroundColor: `rgba(80, 251, 69, ${outputWeights[srcOperatorIx] ?? 0})`,
                color: (outputWeights[srcOperatorIx] ?? 0) > 0.5 ? '#111' : undefined,
              }}
            >
              {Math.abs(outputWeights[srcOperatorIx]) < 0.01
                ? null
                : outputWeights[srcOperatorIx].toFixed(2)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ModulationMatrix;
