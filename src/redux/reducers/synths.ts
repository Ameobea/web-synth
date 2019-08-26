/**
 * Maintains global array of synthesizers (`PolySynth`s) that can be accessed via Redux
 */

import { PolySynth } from '../../synth';

interface State {
  synths: PolySynth[];
  synthsByVCId: { [vcId: string]: PolySynth };
}

const initialState: State = { synths: [], synthsByVCId: {} };

export const actions = {
  SET_SYNTH: 'SET_SYNTH',
};

export const actionCreators = {
  setSynth: (uuid: string, synth: PolySynth): Action => ({ type: actions.SET_SYNTH, uuid, synth }),
};

interface Action {
  type: string;
  synth: PolySynth;
  uuid: string;
}

const synthsReducer = (state = initialState, action: Action): State =>
  ({
    [actions.SET_SYNTH]: {
      ...state,
      synths: [...state.synths, action.synth],
      synthsByVCId: { ...state.synthsByVCId, [action.uuid]: action.synth },
    },
  }[action.type] || state);

export default synthsReducer;
