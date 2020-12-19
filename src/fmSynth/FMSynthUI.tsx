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
    .map(() => new Array(OPERATOR_COUNT + 1).fill(0)),
  outputWeights: new Array(OPERATOR_COUNT).fill(0),
});

type BackendUpdater = (operatorIx: number, modulationIx: number, val: number) => void;

const mkValSetter = (
  state: FMSynthState,
  operatorIx: number,
  modulationIx: number,
  updateBackend: BackendUpdater
) => (val: number): FMSynthState => {
  const newOperatorWeights = [...state.operatorWeights];
  newOperatorWeights[operatorIx] = [...newOperatorWeights[operatorIx]];
  newOperatorWeights[operatorIx][modulationIx] = val;
  return { ...state, operatorWeights: newOperatorWeights };
};

const FMSynthUI: React.FC<{ updateBackend: BackendUpdater }> = ({ updateBackend }) => {
  const [state, setState] = useState(buildDefaultState());
  useEffect(() => {
    const handler = (evt: WheelEvent) => {
      console.log(evt.target);
    };

    window.addEventListener('wheel', handler);
    return () => window.removeEventListener('wheel', handler);
  }, []);

  return (
    <div className='operators'>
      {state.operatorWeights.map((row, i) => (
        <div key={i}>
          {row.map(val => (
            <div key={i}>{val}</div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default FMSynthUI;
