import { ArrayElementOf } from 'ameo-utils';
import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

export interface EqualizerPoint {
  x: number;
  y: number;
}

export interface EqualizerInstanceState {
  points: (EqualizerPoint & {
    xControl?: OverridableAudioParam;
    yControl: OverridableAudioParam;
  })[];
  equalizerNode: AudioWorkletNode | null;
}

interface EqualizerState {
  [vcId: string]: EqualizerInstanceState;
}

const ctx = new AudioContext();

const MAX_EQUALIZER_KNOBS = 16;

const refreshPointConnections = (
  node: AudioWorkletNode,
  point: ArrayElementOf<EqualizerInstanceState['points']>,
  index: number
) => {
  const newXParam = (node.parameters as any).get(`knob_${index}_x`);
  if (newXParam) {
    point.xControl?.replaceParam(newXParam);
  } else {
    point.xControl = undefined;
  }

  const newYParam = (node.parameters as any).get(`knob_${index}_y`);
  point.yControl.replaceParam(newYParam);
};

const actionGroups = {
  ADD_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string, points: EqualizerPoint[]) => ({
      type: 'ADD_INSTANCE',
      vcId,
      points,
    }),
    subReducer: (state: EqualizerState, { vcId, points }): EqualizerState => ({
      ...state,
      [vcId]: {
        points: points.map((pt, i) => {
          const xControl = i === 0 ? undefined : new OverridableAudioParam(ctx);
          if (xControl) {
            xControl.manualControl.offset.value = pt.x + 1;
          }
          const yControl = new OverridableAudioParam(ctx);
          yControl.manualControl.offset.value = pt.y + 1;

          return {
            ...pt,
            xControl,
            yControl,
          };
        }),
        equalizerNode: null,
      },
    }),
  }),
  REGISTER_NODE: buildActionGroup({
    actionCreator: (vcId: string, node: AudioWorkletNode) => ({
      type: 'REGISTER_NODE',
      vcId,
      node,
    }),
    subReducer: (state: EqualizerState, { vcId, node }) => {
      const instanceState = state[vcId];
      // We update the overridable params to swap in params from the actual equalizer instance
      instanceState.points.forEach(({ xControl, yControl }, i) => {
        if (xControl) {
          const param = (node.parameters as any).get(`knob_${i}_x`);
          xControl.replaceParam(param);
        }
        const param = (node.parameters as any).get(`knob_${i}_y`);
        yControl.replaceParam(param);
      });

      return { ...state, [vcId]: { ...instanceState, equalizerNode: node } };
    },
  }),
  REMOVE_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string) => ({ type: 'REMOVE_INSTANCE', vcId }),
    subReducer: (state: EqualizerState, { vcId }) => R.omit([vcId], state),
  }),
  ADD_POINT: buildActionGroup({
    actionCreator: (vcId: string, x: number, y: number) => ({ type: 'ADD_POINT', vcId, x, y }),
    subReducer: (state: EqualizerState, { vcId, x, y }) => {
      const instanceState = state[vcId];
      if (instanceState.points.length >= MAX_EQUALIZER_KNOBS || x === 0 || y === 0) {
        return state;
      }

      const newPoints = [
        ...instanceState.points,
        {
          x,
          y,
          xControl: new OverridableAudioParam(ctx),
          yControl: new OverridableAudioParam(ctx),
        },
      ];
      newPoints.sort((a, b) => 1 - a.x - (1 - b.x));
      if (instanceState.equalizerNode) {
        newPoints
          .slice(1)
          .forEach((pt, i) => refreshPointConnections(instanceState.equalizerNode!, pt, i));
      }

      return {
        ...state,
        [vcId]: { ...instanceState, points: newPoints },
      };
    },
  }),
  REMOVE_POINT: buildActionGroup({
    actionCreator: (vcId: string, index: number) => ({ type: 'REMOVE_POINT', vcId, index }),
    subReducer: (state: EqualizerState, { vcId, index }) => {
      const instanceState = state[vcId];
      instanceState.points[index].xControl?.dispose();
      instanceState.points[index].yControl.dispose();

      const newPoints = R.remove(index, 1, instanceState.points);
      // Since the indices of all points after the removed point changed, we need to re-connect them to the
      // proper params on on the AWN
      if (instanceState.equalizerNode) {
        newPoints
          .slice(index)
          .forEach((pt, i) => refreshPointConnections(instanceState.equalizerNode!, pt, i));
      }

      return {
        ...state,
        [vcId]: { ...instanceState, points: newPoints },
      };
    },
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
      if (instanceState.points[index].xControl) {
        instanceState.points[index].xControl!.manualControl.offset.value = x + 1;
      }
      instanceState.points[index].yControl!.manualControl.offset.value = y + 1;

      return {
        ...state,
        [vcId]: {
          ...instanceState,
          points: R.set(
            R.lensIndex(index),
            { ...state[vcId].points[index], x, y },
            state[vcId].points
          ),
        },
      };
    },
  }),
};

export default buildModule<EqualizerState, typeof actionGroups>({}, actionGroups);
