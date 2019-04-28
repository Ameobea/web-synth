export interface State {
  activeViewContexts: { name: string; uuid: string; title?: string }[];
  activeViewContextIx: number;
}

const initialState: State = {
  activeViewContexts: [],
  activeViewContextIx: 0,
};

const SET_STATE = 'SET_STATE';

export const actionCreators = {
  setState: (state: State): Action => ({ type: SET_STATE, state }),
};

interface InnerAction {
  type: 'SET_STATE';
  state: State;
}

type Action = InnerAction;

const reducer = (state = initialState, action: Action) =>
  ({
    SET_STATE: action.state,
  }[action.type] || state);

export default reducer;
