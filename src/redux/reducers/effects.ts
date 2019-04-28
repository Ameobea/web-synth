export interface Effect {
  id: number;
  title: string;
  description: string;
  code: string;
}

const initialState = {
  sharedEffects: [],
};

interface State {
  sharedEffects: Effect[];
}

export const ADD_EFFECTS = 'ADD_EFFECTS';

interface Action {
  type: typeof ADD_EFFECTS;
  effects: Effect[];
}

export const actionCreators: { [name: string]: (...args: any[]) => Action } = {
  addEffects: (effects: Effect[]) => ({ type: ADD_EFFECTS, effects }),
};

const reducer = (state = initialState, action: Action) => {
  switch (action.type) {
    case ADD_EFFECTS: {
      return { ...state, sharedEffects: action.effects };
    }

    default: {
      return state;
    }
  }
};

export default reducer;
