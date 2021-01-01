import React, { useEffect, useState } from 'react';
import * as R from 'ramda';

import ConfigureOperator, { OperatorConfig } from './ConfigureOperator';
import './FMSynth.scss';
import { classNameIncludes } from 'src/util';
import ConfigureEffects, { Effect } from 'src/fmSynth/ConfigureEffects';
import FMSynth from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

interface FMSynthState {
  modulationIndices: number[][];
  outputWeights: number[];
  operatorConfigs: OperatorConfig[];
  operatorEffects: (Effect | null)[][];
  mainEffectChain: (Effect | null)[];
}

type BackendModulationUpdater = (operatorIx: number, modulationIx: number, val: number) => void;
type BackendOutputUpdater = (operatorIx: number, val: number) => void;

const setModulation = (
  state: FMSynthState,
  operatorIx: number,
  modulationIx: number,
  updateBackendModulation: BackendModulationUpdater,
  getNewVal: (prevVal: number) => number
): FMSynthState => {
  const newmodulationIndices = [...state.modulationIndices];
  newmodulationIndices[operatorIx] = [...newmodulationIndices[operatorIx]];
  newmodulationIndices[operatorIx][modulationIx] = getNewVal(
    newmodulationIndices[operatorIx][modulationIx]
  );
  updateBackendModulation(operatorIx, modulationIx, newmodulationIndices[operatorIx][modulationIx]);
  return { ...state, modulationIndices: newmodulationIndices };
};

const setOutput = (
  state: FMSynthState,
  operatorIx: number,
  updateBackendOutput: BackendOutputUpdater,
  getNewVal: (prevVal: number) => number
): FMSynthState => {
  const newOutputWeights = [...state.outputWeights];
  newOutputWeights[operatorIx] = getNewVal(newOutputWeights[operatorIx]);
  updateBackendOutput(operatorIx, newOutputWeights[operatorIx]);
  return { ...state, outputWeights: newOutputWeights };
};

const ConfigureMainEffectChain: React.FC<{
  mainEffectChain: (Effect | null)[];
  onChange: (ix: number, newEffect: Effect | null) => void;
  setEffects: (newEffects: (Effect | null)[]) => void;
}> = ({ mainEffectChain, onChange, setEffects }) => {
  return (
    <ConfigureEffects state={mainEffectChain} onChange={onChange} setOperatorEffects={setEffects} />
  );
};

const FMSynthUI: React.FC<{
  updateBackendModulation: BackendModulationUpdater;
  updateBackendOutput: BackendOutputUpdater;
  modulationIndices: number[][];
  outputWeights: number[];
  operatorConfigs: OperatorConfig[];
  onOperatorConfigChange: (operatorIx: number, newConfig: OperatorConfig) => void;
  operatorEffects: (Effect | null)[][];
  mainEffectChain: (Effect | null)[];
  setEffect: (operatorIx: number | null, effectIx: number, effect: Effect | null) => void;
  initialSelectedOperatorIx: number | null;
  onOperatorSelected: (operatorIx: number) => void;
}> = ({
  updateBackendModulation,
  updateBackendOutput,
  modulationIndices,
  outputWeights,
  operatorConfigs,
  onOperatorConfigChange,
  operatorEffects,
  mainEffectChain,
  setEffect,
  initialSelectedOperatorIx,
  onOperatorSelected,
}) => {
  const [state, setState] = useState<FMSynthState>({
    modulationIndices,
    outputWeights,
    operatorConfigs,
    operatorEffects,
    mainEffectChain,
  });
  const [selectedOperatorIx, setSelectedOperatorIx] = useState(initialSelectedOperatorIx);

  useEffect(() => {
    const handler = (evt: WheelEvent) => {
      const path = evt.composedPath();
      const operatorElem = path.find(elem =>
        classNameIncludes((elem as any).className, 'operator-square')
      ) as HTMLDivElement | undefined;
      if (!operatorElem) {
        return;
      }

      if (classNameIncludes(operatorElem.className, 'output-weight')) {
        const operatorIx = +operatorElem.getAttribute('data-operator-ix')!;
        setState(
          setOutput(state, operatorIx, updateBackendOutput, (prevVal: number) =>
            R.clamp(0, 1, prevVal + (evt.deltaY > 0 ? -1 : 1) * 0.01)
          )
        );
      } else {
        const srcOperatorIx = +operatorElem.getAttribute('data-src-operator-ix')!;
        const dstOperatorIx = +operatorElem.getAttribute('data-dst-operator-ix')!;
        setState(
          setModulation(
            state,
            srcOperatorIx,
            dstOperatorIx,
            updateBackendModulation,
            (prevVal: number) => prevVal + (evt.deltaY > 0 ? -1 : 1) * 0.1
          )
        );
      }

      evt.preventDefault();
      evt.stopPropagation();
    };

    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, [state, updateBackendModulation, updateBackendOutput]);

  return (
    <div className='fm-synth-ui'>
      <div className='operators'>
        {state.modulationIndices.map((row, srcOperatorIx) => (
          <div className='operator-row' key={srcOperatorIx}>
            <div
              className={
                'operator-select' +
                (selectedOperatorIx === srcOperatorIx ? ' operator-selected' : '')
              }
              onClick={() => {
                setSelectedOperatorIx(srcOperatorIx);
                onOperatorSelected(srcOperatorIx);
              }}
            />
            {row.map((val, dstOperatorIx) => (
              <div
                data-src-operator-ix={srcOperatorIx}
                data-dst-operator-ix={dstOperatorIx}
                className='operator-square'
                key={dstOperatorIx}
              >
                {Math.abs(val) < 0.01 ? null : val.toFixed(2)}
              </div>
            ))}
            <div
              data-operator-ix={srcOperatorIx}
              key='output'
              className='operator-square output-weight'
            >
              {Math.abs(state.outputWeights[srcOperatorIx]) < 0.01
                ? null
                : state.outputWeights[srcOperatorIx].toFixed(2)}
            </div>
          </div>
        ))}
      </div>
      <div
        className='main-effect-chain-selector'
        data-active={selectedOperatorIx === null ? 'true' : 'false'}
        onClick={() => setSelectedOperatorIx(null)}
      >
        MAIN EFFECT CHAIN
      </div>

      {selectedOperatorIx === null ? (
        <ConfigureMainEffectChain
          mainEffectChain={state.mainEffectChain}
          onChange={(effectIx: number, newEffect: Effect | null) => {
            const newMainEffectChain = [...state.mainEffectChain];
            newMainEffectChain[effectIx] = newEffect;
            if (!newEffect) {
              // Slide remaining effects down.  Deleting will trigger this to happen on the backend as well.
              for (let i = effectIx; i < newMainEffectChain.length; i++) {
                const nextEffect = newMainEffectChain[i + 1];
                if (nextEffect) {
                  newMainEffectChain[i] = nextEffect;
                  newMainEffectChain[i + 1] = null;
                  setEffect(null, i + 1, null);
                }
              }
            }

            setEffect(null, effectIx, newEffect);
            setState({ ...state, mainEffectChain: newMainEffectChain });
          }}
          setEffects={(newEffects: (Effect | null)[]) => {
            newEffects.forEach((effect, effectIx) => setEffect(null, effectIx, effect));
            setState({ ...state, mainEffectChain: newEffects });
          }}
        />
      ) : (
        <ConfigureOperator
          config={state.operatorConfigs[selectedOperatorIx]}
          onChange={newConf => {
            setState({
              ...state,
              operatorConfigs: R.set(
                R.lensIndex(selectedOperatorIx),
                newConf,
                state.operatorConfigs
              ),
            });
            onOperatorConfigChange(selectedOperatorIx, newConf);
          }}
          effects={state.operatorEffects[selectedOperatorIx]}
          onEffectsChange={(effectIx: number, newEffect: Effect | null) => {
            setEffect(selectedOperatorIx, effectIx, newEffect);
            const newState = { ...state };
            newState.operatorEffects = [...newState.operatorEffects];
            newState.operatorEffects[selectedOperatorIx] = [
              ...newState.operatorEffects[selectedOperatorIx],
            ];
            newState.operatorEffects[selectedOperatorIx][effectIx] = newEffect;

            if (!newEffect) {
              // Slide remaining effects down.  Deleting will trigger this to happen on the backend as well.
              for (let i = effectIx; i < newState.operatorEffects[selectedOperatorIx].length; i++) {
                const nextEffect = newState.operatorEffects[selectedOperatorIx][i + 1];
                if (nextEffect) {
                  newState.operatorEffects[selectedOperatorIx][i] = nextEffect;
                  newState.operatorEffects[selectedOperatorIx][i + 1] = null;
                  setEffect(selectedOperatorIx, i + 1, null);
                }
              }
            }

            setState(newState);
          }}
          setEffects={newEffects => {
            newEffects.forEach((effect, effectIx) =>
              setEffect(selectedOperatorIx, effectIx, effect)
            );
            setState({
              ...state,
              operatorEffects: R.set(
                R.lensIndex(selectedOperatorIx),
                newEffects,
                state.operatorEffects
              ),
            });
          }}
        />
      )}
    </div>
  );
};

export const ConnectedFMSynthUI: React.FC<{ synth: FMSynth }> = ({ synth }) => (
  <FMSynthUI
    updateBackendModulation={(srcOperatorIx: number, dstOperatorIx: number, val: number) =>
      synth.handleModulationIndexChange(srcOperatorIx, dstOperatorIx, val)
    }
    updateBackendOutput={(operatorIx: number, val: number) =>
      synth.handleOutputWeightChange(operatorIx, val)
    }
    modulationIndices={synth.getModulationIndices()}
    outputWeights={synth.getOutputWeights()}
    operatorConfigs={synth.getOperatorConfigs()}
    onOperatorConfigChange={(operatorIx: number, newOperatorConfig: OperatorConfig) =>
      synth.handleOperatorConfigChange(operatorIx, newOperatorConfig)
    }
    operatorEffects={synth.getOperatorEffects()}
    mainEffectChain={synth.getMainEffectChain()}
    setEffect={synth.setEffect.bind(synth)}
    initialSelectedOperatorIx={synth.selectedOperatorIx}
    onOperatorSelected={opIx => {
      synth.selectedOperatorIx = opIx;
    }}
  />
);

export default FMSynthUI;
