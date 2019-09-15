import { buildModule, buildActionGroup } from 'jantix';

export interface Effect {
  id: number;
  title: string;
  description: string;
  code: string;
}

const initialState = {
  sharedEffects: [],
};

interface EffectsState {
  sharedEffects: Effect[];
}

const actionGroups = {
  ADD_EFFECTS: buildActionGroup({
    actionCreator: (effects: Effect[]) => ({ type: 'ADD_EFFECTS', effects }),
    subReducer: (state: EffectsState, { effects }) => ({ ...state, sharedEffects: effects }),
  }),
};

export default buildModule<EffectsState, typeof actionGroups>(initialState, actionGroups);
