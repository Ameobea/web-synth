import { ArrayElementOf } from 'ameo-utils';
import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

export interface EqualizerPoint {
  index: number;
  x: number;
  y: number;
}

export interface EqualizerInstanceState {
  points: EqualizerPoint[];
  csns: { xControl?: OverridableAudioParam; yControl: OverridableAudioParam }[];
  equalizerNode: AudioWorkletNode | null;
}

interface EqualizerState {
  [vcId: string]: EqualizerInstanceState;
}

const ctx = new AudioContext();

const MAX_EQUALIZER_KNOBS = 16;

const updateParams = (
  { xControl, yControl }: ArrayElementOf<EqualizerInstanceState['csns']>,
  pt?: EqualizerPoint
) => {
  if (!pt) {
    if (xControl) {
      xControl.manualControl.offset.value = -1;
    }
    yControl.manualControl.offset.value = -1;
    return;
  }

  if (xControl) {
    xControl.manualControl.offset.value = pt.x;
  }
  yControl.manualControl.offset.value = pt.y;
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
        points,
        csns: new Array(MAX_EQUALIZER_KNOBS).fill(null).map((_, i) => ({
          xControl:
            i !== 0 && i !== MAX_EQUALIZER_KNOBS - 1 ? new OverridableAudioParam(ctx) : undefined,
          yControl: new OverridableAudioParam(ctx),
        })),
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
      instanceState.csns.forEach(({ xControl, yControl }, i) => {
        if (xControl) {
          const param = (node.parameters as any).get(`knob_${i}_x`);
          xControl.replaceParam(param);
        }
        const param = (node.parameters as any).get(`knob_${i}_y`);
        yControl.replaceParam(param);
      });
      instanceState.csns.forEach((csns, i) => updateParams(csns, instanceState.points[i]));

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

      const index = instanceState.points.reduce((acc, pt) => Math.max(acc, pt.index), 0) + 1;
      const newPoint = {
        index,
        x,
        y,
      };
      const newPoints = [...instanceState.points, newPoint];
      newPoints.sort((a, b) => 1 - a.x - (1 - b.x));
      instanceState.csns.forEach((csns, i) => updateParams(csns, newPoints[i]));

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
      const newPoints = instanceState.points.filter(R.propEq('index', index));
      const removedIx = instanceState.points.findIndex(pt => pt.index === index)!;
      const controls = instanceState.csns[removedIx];
      controls.xControl?.dispose();
      controls.yControl.dispose();
      instanceState.csns.forEach((csns, i) => updateParams(csns, newPoints[i]));

      return {
        ...state,
        [vcId]: { ...instanceState, points: newPoints },
      };
    },
  }),
  UPDATE_POINT: buildActionGroup({
    actionCreator: (vcId: string, newPoint: EqualizerPoint) => ({
      type: 'UPDATE_POINT',
      vcId,
      newPoint,
    }),
    subReducer: (state: EqualizerState, { vcId, newPoint }) => {
      const instanceState = state[vcId];
      const targetPointIx = instanceState.points.findIndex(pt => pt.index === newPoint.index);
      const newPoints = [...instanceState.points];
      newPoints[targetPointIx] = { ...newPoints[targetPointIx], ...newPoint };
      newPoints.sort((a, b) => a.x - b.x);
      if (newPoints[0].x !== 0) {
        newPoints[0].x = 0;
      }
      if (newPoints[newPoints.length - 1].x !== 1) {
        newPoints[newPoints.length - 1].x = 1;
      }
      instanceState.csns.forEach((csns, i) => updateParams(csns, newPoints[i]));

      return {
        ...state,
        [vcId]: {
          ...instanceState,
          points: newPoints,
        },
      };
    },
  }),
};

export default buildModule<EqualizerState, typeof actionGroups>({}, actionGroups);
