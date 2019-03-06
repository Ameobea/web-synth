/**
 * Maintains global array of synthesizers (`PolySynth`s) that can be accessed via Redux
 */

import { PolySynth } from '../../synth';

interface State {
  synths: PolySynth[];
}

const initialState: State = { synths: [] };

export const actions = {
  SET_SYNTH: 'SET_SYNTH',
};

export const actionCreators = {
  setSynth: (synth: PolySynth) => ({ type: actions.SET_SYNTH, synth }),
};

interface Action {
  type: string;
  synth: PolySynth;
}

const synthsReducer = (state = initialState, action: Action): State =>
  ({
    [actions.SET_SYNTH]: { ...state, synths: [...state.synths, action.synth] },
  }[action.type] || state);

export default synthsReducer;
