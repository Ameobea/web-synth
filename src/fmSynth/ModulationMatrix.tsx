import React, { useState } from 'react';

import type { OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import type { ParamSource } from 'src/fmSynth/ConfigureParamSource';
import type { UISelection } from 'src/fmSynth/FMSynthUI';

const formatOperatorConfig = (config: OperatorConfig) => {
  if (
    (config.type === 'sine oscillator' ||
      config.type === 'exponential oscillator' ||
      config.type === 'triangle oscillator' ||
      config.type === 'square oscillator' ||
      config.type === 'sawtooth oscillator') &&
    config.frequency.type === 'base frequency multiplier'
  ) {
    const abbrev = {
      'sine oscillator': 'SINE',
      'exponential oscillator': 'EXP',
      'triangle oscillator': 'TRI',
      'square oscillator': 'SQR',
      'sawtooth oscillator': 'SAW',
    }[config.type];
    return (
      <>
        <span style={{ fontSize: 11 }}>{abbrev}</span>
        {config.frequency.multiplier.toFixed(3)}
      </>
    );
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

const OutputWeightSquare: React.FC<{
  operatorIx: number;
  outputWeights: ParamSource[];
  onClick: () => void;
  isSelected: boolean;
}> = ({ operatorIx, outputWeights, onClick, isSelected }) => {
  const val = outputWeights[operatorIx];
  const operatorWeight = val.type === 'constant' ? val.value : null;

  const style = (() => {
    if (isSelected) {
      return undefined;
    }

    if (operatorWeight === null) {
      return { backgroundColor: '#2ffab6', color: 'black' };
    }
    return {
      backgroundColor: `rgba(80, 251, 69, ${operatorWeight})`,
      color: operatorWeight > 0.5 ? '#111' : undefined,
    };
  })();

  return (
    <div
      onClick={onClick}
      data-operator-ix={operatorIx}
      data-selected={isSelected ? 'true' : 'false'}
      key='output'
      className='operator-square output-weight'
    >
      <div className='operator-weight-lens' style={style}>
        {operatorWeight !== null && Math.abs(operatorWeight) < 0.01
          ? null
          : formatParamSource(outputWeights[operatorIx])}
      </div>
    </div>
  );
};

export const ModulationMatrix: React.FC<{
  selectedUI: UISelection | null;
  onOperatorSelected: (newSelectedOperatorIx: number) => void;
  resetModulationIndex: (srcOperatorIx: number, dstOperatorIx: number) => void;
  onModulationIndexSelected: (srcOperatorIx: number, dstOperatorIx: number) => void;
  modulationIndices: ParamSource[][];
  operatorConfigs: OperatorConfig[];
  outputWeights: ParamSource[];
  onOutputWeightSelected: (operatorIx: number) => void;
}> = ({
  selectedUI,
  onOperatorSelected,
  resetModulationIndex,
  onModulationIndexSelected,
  modulationIndices,
  operatorConfigs,
  outputWeights,
  onOutputWeightSelected,
}) => {
  const [hoveredColIx, setHoveredColIx] = useState<number | null>(null);

  const selectedOperatorIx = selectedUI?.type === 'operator' ? selectedUI.index : null;

  return (
    <div className='modulation-matrix' onMouseLeave={() => setHoveredColIx(null)}>
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
              onMouseEnter={() => setHoveredColIx(dstOperatorIx)}
            >
              {formatParamSource(val)}
            </div>
          ))}
          <OutputWeightSquare
            onClick={() => onOutputWeightSelected(srcOperatorIx)}
            operatorIx={srcOperatorIx}
            outputWeights={outputWeights}
            isSelected={
              selectedUI?.type === 'outputWeight' && selectedUI.operatorIx === srcOperatorIx
            }
          />
        </div>
      ))}
    </div>
  );
};

export default ModulationMatrix;
