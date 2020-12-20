import React, { useEffect, useRef, useState } from 'react';
import * as R from 'ramda';

import './FMSynth.scss';

const OPERATOR_COUNT = 8;

interface FMSynthState {
  operatorWeights: number[][];
  outputWeights: number[];
}

const buildDefaultState = (): FMSynthState => ({
  operatorWeights: new Array(OPERATOR_COUNT)
    .fill(null as any)
    // One output to each of the oscillators including self for feedback and
    .map(() => new Array(OPERATOR_COUNT).fill(0)),
  outputWeights: new Array(OPERATOR_COUNT).fill(0),
});

type BackendModulationUpdater = (operatorIx: number, modulationIx: number, val: number) => void;
type BackendOutputUpdater = (operatorIx: number, val: number) => void;

const setModulation = (
  state: FMSynthState,
  operatorIx: number,
  modulationIx: number,
  updateBackendModulation: BackendModulationUpdater,
  getNewVal: (prevVal: number) => number
): FMSynthState => {
  const newOperatorWeights = [...state.operatorWeights];
  newOperatorWeights[operatorIx] = [...newOperatorWeights[operatorIx]];
  newOperatorWeights[operatorIx][modulationIx] = getNewVal(
    newOperatorWeights[operatorIx][modulationIx]
  );
  updateBackendModulation(operatorIx, modulationIx, newOperatorWeights[operatorIx][modulationIx]);
  return { ...state, operatorWeights: newOperatorWeights };
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

const FMSynthUI: React.FC<{
  updateBackendModulation: BackendModulationUpdater;
  updateBackendOutput: BackendOutputUpdater;
}> = ({ updateBackendModulation, updateBackendOutput }) => {
  const [state, setState] = useState(buildDefaultState());

  useEffect(() => {
    const handler = (evt: WheelEvent) => {
      const path = evt.composedPath();
      const operatorElem = path.find(elem =>
        (elem as any).className?.includes('operator-square')
      ) as HTMLDivElement | undefined;
      if (!operatorElem) {
        return;
      }

      if (operatorElem.className.includes('output-weight')) {
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
    <div className='operators'>
      {state.operatorWeights.map((row, srcOperatorIx) => (
        <div key={srcOperatorIx}>
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
  );
};

export default FMSynthUI;
