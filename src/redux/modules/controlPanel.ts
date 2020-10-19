import { buildActionGroup, buildModule } from 'jantix';

import { ControlPanelInput } from 'src/controlPanel';

export interface ControlPanelState {
  stateByPanelInstance: {
    [controlPanelVcId: string]: ControlPanelInstanceState;
  };
}

export type ControlInfo =
  | { type: 'range'; min: number; max: number; value: number }
  | { type: 'gate'; value: number; isPressed: boolean };

export const buildDefaultControlState = (): ControlInfo => ({
  type: 'range',
  min: 0,
  max: 100,
  value: 0,
});

export const buildDefaultControl = (name: string): Control => ({
  data: buildDefaultControlState(),
  label: name,
  color: '#fff',
  position: { x: 0, y: 0 },
});

export interface Control {
  data: ControlInfo;
  label: string;
  color: string;
  position: { x: number; y: number };
}

export interface ControlPanelConnection {
  vcId: string;
  name: string;
  node: ControlPanelInput;
  control: Control;
}

export interface ControlPanelInstanceState {
  connections: ControlPanelConnection[];
}

const initialState: ControlPanelState = { stateByPanelInstance: {} };

const ctx = new AudioContext();

const actionGroups = {
  ADD_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string, initialConnections?: Omit<ControlPanelConnection, 'node'>[]) => ({
      type: 'ADD_INSTANCE',
      vcId,
      initialConnections,
    }),
    subReducer: (state: ControlPanelState, { vcId, initialConnections }) => {
      const connections = initialConnections
        ? initialConnections.map(conn => ({ ...conn, node: new ControlPanelInput(ctx, vcId) }))
        : [];

      return {
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [vcId]: {
            connections,
          },
        },
      };
    },
  }),
  REMOVE_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string) => ({ type: 'REMOVE_INSTANCE', vcId }),
    subReducer: (state: ControlPanelState, { vcId }) => {
      delete state.stateByPanelInstance[vcId];
      return { stateByPanelInstance: { ...state.stateByPanelInstance } };
    },
  }),
  ADD_CONNECTION: buildActionGroup({
    actionCreator: (controlPanelVcId: string, vcId: string, name: string) => ({
      type: 'ADD_CONNECTION',
      controlPanelVcId,
      vcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name }) => ({
      ...state,
      stateByPanelInstance: {
        ...state.stateByPanelInstance,
        [controlPanelVcId]: {
          ...state.stateByPanelInstance[controlPanelVcId],
          connections: [
            ...state.stateByPanelInstance[controlPanelVcId].connections,
            {
              vcId,
              name,
              node: new ControlPanelInput(ctx, controlPanelVcId),
              control: buildDefaultControl(name),
            },
          ],
        },
      },
    }),
  }),
  REMOVE_CONNECTION: buildActionGroup({
    actionCreator: (controlPanelVcId: string, vcId: string, name: string) => ({
      type: 'REMOVE_CONNECTION',
      controlPanelVcId,
      vcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name }) => ({
      ...state,
      stateByPanelInstance: {
        ...state.stateByPanelInstance,
        [controlPanelVcId]: {
          ...state.stateByPanelInstance[controlPanelVcId],
          connections: state.stateByPanelInstance[controlPanelVcId].connections.filter(
            conn => conn.vcId !== vcId && conn.name !== name
          ),
        },
      },
    }),
  }),
};

export default buildModule<ControlPanelState, typeof actionGroups>(initialState, actionGroups);
