import React, { useEffect, useState } from 'react';
import { ThemesByType } from 'src/fmSynth/ConfigureEffects';

import type { OperatorConfig } from 'src/fmSynth/ConfigureOperator';
import type { Effect } from 'src/fmSynth/Effect';
import type { UISelection } from 'src/fmSynth/FMSynthUI';
import type { ParamSource } from 'src/fmSynth/ParamSource';
import TrainingMIDIControlIndexContext from 'src/fmSynth/TrainingMIDIControlIndexContext';
import type MIDIControlValuesCache from 'src/graphEditor/nodes/CustomAudio/FMSynth/MIDIControlValuesCache';
import { filterNils } from 'src/util';

const formatOperatorConfig = (config: OperatorConfig) => {
  if (config.type === 'sample mapping') {
    return 'S-MAP';
  } else if (config.type === 'tuned sample') {
    return 'SAMP';
  } else if (config.type === 'white noise') {
    return 'NOIS';
  }

  if (
    (config.type === 'sine oscillator' ||
      config.type === 'exponential oscillator' ||
      config.type === 'triangle oscillator' ||
      config.type === 'square oscillator' ||
      config.type === 'sawtooth oscillator' ||
      config.type === 'wavetable') &&
    config.frequency.type === 'base frequency multiplier'
  ) {
    const abbrev = {
      'sine oscillator': 'SINE',
      'exponential oscillator': 'EXP',
      'triangle oscillator': 'TRI',
      'square oscillator': 'SQR',
      'sawtooth oscillator': 'SAW',
      wavetable: 'TABL',
      'sample mapping': 'SAMP',
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

interface FormattedMIDIControlValueProps {
  controlIndex: number;
  scale: number;
  shift: number;
  midiControlValuesCache: MIDIControlValuesCache;
}

const FormattedMIDIControlValue: React.FC<FormattedMIDIControlValueProps> = ({
  midiControlValuesCache,
  controlIndex,
  scale,
  shift,
}) => {
  const [rawValue, setRawValue] = useState(midiControlValuesCache.get(controlIndex));
  useEffect(() => {
    const callback = (newValue: number) => setRawValue(newValue);
    midiControlValuesCache.registerCallback(controlIndex, callback);

    return () => midiControlValuesCache.unregisterCallback(controlIndex, callback);
  }, [controlIndex, midiControlValuesCache]);

  return <>{((rawValue / 127) * scale + shift).toFixed(2)}</>;
};

interface FormattedParamSourceProps {
  param: ParamSource;
}

const FormattedParamSource: React.FC<FormattedParamSourceProps> = ({ param }) => {
  if (param.type === 'constant') {
    return <>{Math.abs(param.value) < 0.01 ? null : param.value.toFixed(2)}</>;
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
  } else if (param.type === 'midi control') {
    if (
      param.type === 'midi control' &&
      param.midiControlIndex !== null &&
      param.midiControlIndex !== 'LEARNING'
    ) {
      return (
        <TrainingMIDIControlIndexContext.Consumer>
          {({ midiControlValuesCache }) => (
            <FormattedMIDIControlValue
              midiControlValuesCache={midiControlValuesCache}
              controlIndex={param.midiControlIndex}
              scale={param.scale}
              shift={param.shift}
            />
          )}
        </TrainingMIDIControlIndexContext.Consumer>
      );
    } else {
      return <>{'...'}</>;
    }
  } else if (param.type === 'param buffer') {
    return <>{`IN ${param['buffer index']}`}</>;
  } else {
    return <>{'-'}</>;
  }
};

interface EffectDotProps {
  effect: Effect;
  effectIx: number;
}

const EffectDot: React.FC<EffectDotProps> = ({ effect, effectIx }) => (
  <div
    className='effect-dot'
    style={{ background: ThemesByType[effect.type].background2, left: effectIx * 6 }}
  />
);

interface EffectDotsProps {
  effects: (Effect | null)[];
}

export const EffectDots: React.FC<EffectDotsProps> = ({ effects }) => (
  <>
    {filterNils(effects)
      .slice(0, 7)
      .map((effect, i) => (
        <EffectDot key={i} effect={effect} effectIx={i} />
      ))}
  </>
);

interface OutputWeightSquareProps {
  operatorIx: number;
  outputWeights: ParamSource[];
  onClick: () => void;
  isSelected: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  synthID: string;
}

const OutputWeightSquare: React.FC<OutputWeightSquareProps> = ({
  operatorIx,
  outputWeights,
  onClick,
  isSelected,
  onMouseEnter,
  onMouseLeave,
  synthID,
}) => {
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
      data-synth-id={synthID}
      key='output'
      className='operator-square output-weight'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className='operator-weight-lens' style={style}>
        {operatorWeight !== null && Math.abs(operatorWeight) < 0.01 ? null : (
          <FormattedParamSource param={outputWeights[operatorIx]} />
        )}
      </div>
    </div>
  );
};

const getModulationIndexName = (srcOperatorIx: number, dstOperatorIx: number) => {
  if (srcOperatorIx === dstOperatorIx) {
    return `Operator ${srcOperatorIx + 1} Feedback`;
  }

  return `Operator ${srcOperatorIx + 1} -> ${dstOperatorIx + 1} Modulation Index`;
};

interface ModulationMatrixProps {
  selectedUI: UISelection | null;
  onOperatorSelected: (newSelectedOperatorIx: number) => void;
  resetModulationIndex: (srcOperatorIx: number, dstOperatorIx: number) => void;
  onModulationIndexSelected: (srcOperatorIx: number, dstOperatorIx: number) => void;
  modulationIndices: ParamSource[][];
  operatorConfigs: OperatorConfig[];
  outputWeights: ParamSource[];
  operatorEffects: (Effect | null)[][];
  onOutputWeightSelected: (operatorIx: number) => void;
  synthID: string;
}

export const ModulationMatrix: React.FC<ModulationMatrixProps> = ({
  selectedUI,
  onOperatorSelected,
  resetModulationIndex,
  onModulationIndexSelected,
  modulationIndices,
  operatorConfigs,
  outputWeights,
  operatorEffects,
  onOutputWeightSelected,
  synthID,
}) => {
  const [hoveredColIx, setHoveredColIx] = useState<number | null>(null);
  const [hoveredModulationEntity, setHoveredModulationEntity] = useState<string | null>(null);

  const selectedOperatorIx = selectedUI?.type === 'operator' ? selectedUI.index : null;

  return (
    <>
      <div className='hovered-modulation-entity'>{hoveredModulationEntity}</div>
      <div className='modulation-matrix' onMouseLeave={() => setHoveredColIx(null)}>
        {modulationIndices.map((row, srcOperatorIx) => (
          <div className='operator-row' key={srcOperatorIx}>
            <div
              data-hovered={hoveredColIx === srcOperatorIx ? 'true' : 'false'}
              className={
                'operator-select' +
                (selectedOperatorIx === srcOperatorIx ? ' operator-selected' : '')
              }
              onClick={() => onOperatorSelected(srcOperatorIx)}
              onMouseEnter={() =>
                setHoveredModulationEntity(`Operator ${srcOperatorIx + 1} Config`)
              }
              onMouseLeave={() => {
                if (hoveredModulationEntity === `Operator ${srcOperatorIx + 1} Config`) {
                  setHoveredModulationEntity(null);
                }
              }}
            >
              {formatOperatorConfig(operatorConfigs[srcOperatorIx])}
              <EffectDots effects={operatorEffects[srcOperatorIx]} />
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
                className={`operator-square${
                  srcOperatorIx === dstOperatorIx ? ' operator-square-feedback' : ''
                }`}
                data-synth-id={synthID}
                key={dstOperatorIx}
                onClick={() => onModulationIndexSelected(srcOperatorIx, dstOperatorIx)}
                onMouseEnter={() => {
                  setHoveredColIx(dstOperatorIx);
                  setHoveredModulationEntity(getModulationIndexName(srcOperatorIx, dstOperatorIx));
                }}
                onMouseLeave={() => {
                  if (
                    hoveredModulationEntity === getModulationIndexName(srcOperatorIx, dstOperatorIx)
                  ) {
                    setHoveredModulationEntity(null);
                  }
                }}
                onDoubleClick={() => {
                  if (val.type === 'constant') {
                    resetModulationIndex(srcOperatorIx, dstOperatorIx);
                  }
                }}
              >
                <FormattedParamSource param={val} />
              </div>
            ))}
            <OutputWeightSquare
              onClick={() => onOutputWeightSelected(srcOperatorIx)}
              operatorIx={srcOperatorIx}
              outputWeights={outputWeights}
              isSelected={
                selectedUI?.type === 'outputWeight' && selectedUI.operatorIx === srcOperatorIx
              }
              onMouseEnter={() =>
                setHoveredModulationEntity(`Operator ${srcOperatorIx + 1} Output Weight`)
              }
              onMouseLeave={() => {
                if (hoveredModulationEntity === `Operator ${srcOperatorIx + 1} Output Weight`) {
                  setHoveredModulationEntity(null);
                }
              }}
              synthID={synthID}
            />
          </div>
        ))}
      </div>
    </>
  );
};

export default React.memo(ModulationMatrix);
