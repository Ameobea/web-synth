import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';

import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { updateConnectables } from 'src/patchNetwork/interface';
import { actionCreators, dispatch, getState } from 'src/redux';

export interface EqualizerPoint {
  index: number;
  x: number;
  y: number;
}

export interface EqualizerInstanceState {
  points: (EqualizerPoint & {
    xControl?: OverridableAudioParam;
    yControl: OverridableAudioParam;
    isManuallyControlled: boolean;
  })[];
  equalizerNode: AudioWorkletNode | null;
  levels: Float32Array;
  isBypassed: boolean;
  bypassCsn: OverridableAudioParam;
  smoothFactor: number;
  smoothFactorCsn: OverridableAudioParam;
}

interface EqualizerState {
  [vcId: string]: EqualizerInstanceState;
}

const ctx = new AudioContext();

const MAX_EQUALIZER_KNOBS = 16;
export const EQUALIZER_LEVEL_COUNT = 20;

const updateEqualizerConnectablesOnNextTick = (vcId: string) =>
  setTimeout(() => {
    const node = getState().viewContextManager.patchNetwork.connectables.get(vcId)?.node;
    if (!node) {
      console.warn('Equalizer not found in patch network to update connectables');
      return;
    }
    const newConnectables = node.buildConnectables();
    updateConnectables(vcId, newConnectables);
  });

const actionGroups = {
  ADD_EQUALIZER_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string, points: EqualizerPoint[]) => ({
      type: 'ADD_EQUALIZER_INSTANCE',
      vcId,
      points,
    }),
    subReducer: (state: EqualizerState, { vcId, points }): EqualizerState => {
      const smoothFactorCsn = new OverridableAudioParam(ctx);
      const smoothFactor = 0.9;
      smoothFactorCsn.manualControl.offset.value = smoothFactor;

      return {
        ...state,
        [vcId]: {
          points: points.map((pt, i) => {
            const xControl = i !== 0 ? new OverridableAudioParam(ctx) : undefined;
            if (xControl) {
              xControl!.manualControl.offset.value = pt.x;
              xControl.onOverrideStatusChange(() =>
                setTimeout(() =>
                  dispatch(actionCreators.equalizer.SET_KNOB_IS_MANUALLY_CONTROLLED(vcId, pt.index))
                )
              );
            }
            const yControl = new OverridableAudioParam(ctx);
            yControl.manualControl.offset.value = pt.y;

            return {
              ...pt,
              xControl,
              yControl,
              isManuallyControlled: false,
            };
          }),
          equalizerNode: null,
          levels: new Float32Array(EQUALIZER_LEVEL_COUNT).fill(0),
          bypassCsn: new OverridableAudioParam(ctx),
          isBypassed: false,
          smoothFactorCsn,
          smoothFactor,
        },
      };
    },
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
      instanceState.points.forEach(({ x, y, xControl, yControl }, i) => {
        if (xControl) {
          const param = (node.parameters as any).get(`knob_${i}_x`);
          xControl.replaceParam(param);
          xControl.manualControl.offset.value = x;
        }
        const param = (node.parameters as any).get(`knob_${i}_y`);
        yControl.replaceParam(param);
        yControl.manualControl.offset.value = y;
      });
      instanceState.smoothFactorCsn.replaceParam((node.parameters as any).get('smooth factor'));
      instanceState.bypassCsn.replaceParam((node.parameters as any).get('bypass'));

      return {
        ...state,
        [vcId]: {
          ...instanceState,
          equalizerNode: node,
          points: instanceState.points.map(pt => ({
            ...pt,
            isManuallyControlled:
              (pt.xControl?.getIsOverridden() ?? true) && pt.yControl.getIsOverridden(),
          })),
        },
      };
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
      const i = instanceState.points.length + 1;
      const newPoint = {
        index,
        x,
        y,
        xControl: new OverridableAudioParam(
          ctx,
          (instanceState.equalizerNode?.parameters as any)?.get(`knob_${i}_x`)
        ),
        yControl: new OverridableAudioParam(
          ctx,
          (instanceState.equalizerNode?.parameters as any)?.get(`knob_${i}_y`)
        ),
        isManuallyControlled: true,
      };
      newPoint.xControl.manualControl.offset.value = x;
      newPoint.yControl.manualControl.offset.value = y;
      const newPoints = [...instanceState.points, newPoint];
      newPoints.sort((a, b) => a.x - b.x);

      updateEqualizerConnectablesOnNextTick(vcId);

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
      const removedPoint = instanceState.points.find(R.propEq(index, 'index'));
      if (!removedPoint) {
        console.error(`Tried to remove point index ${index} but it is not found`);
        return state;
      }
      if (removedPoint.x === 0 || removedPoint.x === 1) {
        // Can't remove the border points
        return state;
      }
      removedPoint.xControl?.dispose();
      removedPoint.yControl.dispose();
      const newPoints = instanceState.points.filter(o => o.index !== index);

      updateEqualizerConnectablesOnNextTick(vcId);

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
      newPoint.x = R.clamp(0, 1, newPoint.x);
      newPoint.y = R.clamp(0, 1, newPoint.y);

      const instanceState = state[vcId];
      const targetPointIx = instanceState.points.findIndex(pt => pt.index === newPoint.index);
      const newPoints = [...instanceState.points];
      const oldPoint = newPoints[targetPointIx];
      // Prevent users from moving the border points off the borders
      if (newPoint.x === 0 && oldPoint.x !== 0) {
        newPoint.x = 0.005;
      } else if (newPoint.x === 1 && oldPoint.x !== 1) {
        newPoint.x = 0.996;
      } else if (oldPoint.x === 0 || oldPoint.x === 1) {
        newPoint.x = oldPoint.x;
      }

      newPoints[targetPointIx] = { ...oldPoint, ...newPoint };
      if (newPoints[targetPointIx].xControl) {
        newPoints[targetPointIx].xControl!.manualControl.offset.value = newPoint.x;
      }
      newPoints[targetPointIx].yControl.manualControl.offset.value = newPoint.y;

      newPoints.sort((a, b) => a.x - b.x);
      if (newPoints[0].x !== 0) {
        newPoints[0].x = 0;
      }
      if (newPoints[newPoints.length - 1].x !== 1) {
        newPoints[newPoints.length - 1].x = 1;
      }

      return {
        ...state,
        [vcId]: {
          ...instanceState,
          points: newPoints,
        },
      };
    },
  }),
  SET_LEVELS: buildActionGroup({
    actionCreator: (vcId: string, levels: Float32Array) => ({ type: 'SET_LEVELS', vcId, levels }),
    subReducer: (state: EqualizerState, { vcId, levels }) => ({
      ...state,
      [vcId]: { ...state[vcId], levels },
    }),
  }),
  SET_KNOB_IS_MANUALLY_CONTROLLED: buildActionGroup({
    actionCreator: (vcId: string, knobIx: number) => ({
      type: 'SET_KNOB_IS_MANUALLY_CONTROLLED',
      vcId,
      knobIx,
    }),
    subReducer: (state: EqualizerState, { vcId, knobIx }) => {
      const arrayIx = state[vcId].points.findIndex(pt => pt.index === knobIx);
      if (arrayIx === -1) {
        console.error(
          `Tried to set knob with index ${knobIx} as manually controlled, but wasn't found`
        );
        return state;
      }
      const point = state[vcId].points[arrayIx];

      return {
        ...state,
        [vcId]: {
          ...state[vcId],
          points: R.set(
            R.lensIndex(arrayIx),
            {
              ...point,
              isManuallyControlled:
                (point.xControl?.getIsOverridden() ?? true) && point.yControl.getIsOverridden(),
            },
            state[vcId].points
          ),
        },
      };
    },
  }),
  SET_IS_BYPASSED: buildActionGroup({
    actionCreator: (vcId: string, isBypassed: boolean) => ({
      type: 'SET_IS_BYPASSED',
      vcId,
      isBypassed,
    }),
    subReducer: (state: EqualizerState, { vcId, isBypassed }) => {
      state[vcId].bypassCsn.manualControl.offset.value = isBypassed ? 1 : 0;
      return { ...state, [vcId]: { ...state[vcId], isBypassed } };
    },
  }),
  SET_SMOOTH_FACTOR: buildActionGroup({
    actionCreator: (vcId: string, smoothFactor: number) => ({
      type: 'SET_SMOOTH_FACTOR',
      vcId,
      smoothFactor,
    }),
    subReducer: (state: EqualizerState, { vcId, smoothFactor }) => {
      const clampedSmoothFactor = R.clamp(0, 1, smoothFactor);
      state[vcId].smoothFactorCsn.manualControl.offset.value = clampedSmoothFactor;
      return { ...state, [vcId]: { ...state[vcId], smoothFactor: clampedSmoothFactor } };
    },
  }),
};

export default buildModule<EqualizerState, typeof actionGroups>({}, actionGroups);
