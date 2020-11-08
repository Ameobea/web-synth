import { Option } from 'funfix-core';
import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';

export interface EqualizerPoint {
  x: number;
  y: number;
}

export interface EqualizerInstanceState {
  points: EqualizerPoint[];
}

interface EqualizerState {
  [vcId: string]: EqualizerInstanceState;
}

const actionGroups = {
  ADD_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string, instanceState: EqualizerInstanceState) => ({
      type: 'ADD_INSTANCE',
      vcId,
      instanceState,
    }),
    subReducer: (state: EqualizerState, { vcId, instanceState }): EqualizerState => ({
      ...state,
      [vcId]: instanceState,
    }),
  }),
  REMOVE_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string) => ({ type: 'REMOVE_INSTANCE', vcId }),
    subReducer: (state: EqualizerState, { vcId }) => R.omit([vcId], state),
  }),
  ADD_POINT: buildActionGroup({
    actionCreator: (vcId: string, x: number, y: number) => ({ type: 'ADD_POINT', vcId, x, y }),
    subReducer: (state: EqualizerState, { vcId, x, y }) => {
      const newPoints = [...state[vcId].points, { x, y }];
      newPoints.sort((a, b) => a.x - b.x);

      return {
        ...state,
        [vcId]: { ...state[vcId], points: newPoints },
      };
    },
  }),
  REMOVE_POINT: buildActionGroup({
    actionCreator: (vcId: string, index: number) => ({ type: 'REMOVE_POINT', vcId, index }),
    subReducer: (state: EqualizerState, { vcId, index }) => ({
      ...state,
      [vcId]: { ...state[vcId], points: R.remove(index, 1, state[vcId].points) },
    }),
  }),
  UPDATE_POINT: buildActionGroup({
    actionCreator: (vcId: string, index: number, newPoint: EqualizerPoint) => ({
      type: 'UPDATE_POINT',
      vcId,
      index,
      newPoint,
    }),
    subReducer: (state: EqualizerState, { vcId, index, newPoint }) => {
      const instanceState = state[vcId];
      const [leftNeighborX, rightNeighborX] = [
        index === instanceState.points.length - 1 ? 1 : instanceState.points[index - 1]?.x ?? 0,
        index === 0 ? 0 : instanceState.points[index + 1]?.x ?? 1,
      ];
      const x = R.clamp(leftNeighborX, rightNeighborX, newPoint.x);
      const y = R.clamp(0, 1, newPoint.y);

      return {
        ...state,
        [vcId]: {
          ...instanceState,
          points: R.set(R.lensIndex(index), { x, y }, state[vcId].points),
        },
      };
    },
  }),
};

export default buildModule<EqualizerState, typeof actionGroups>({}, actionGroups);
