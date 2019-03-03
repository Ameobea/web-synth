/**
 * Maintains global array of synthesizers (`PolySynth`s) that can be accessed via Redux
 */

import { PolySynth } from '../../synth';

const initialState: { synths: PolySynth[] } = { synths: [] };

export const actions = {
  SET_SYNTH: 'SET_SYNTH',
};

export const actionCreators = {
  setSynth: (synth: PolySynth) => ({ type: actions.SET_SYNTH, synth }),
};

const synthsReducer = (state = initialState, action) =>
  ({
    [actions.SET_SYNTH]: { ...state, synths: [...state.synths, action.synth] },
  }[action.type] || state);

export default synthsReducer;
