import { buildActionGroup, buildModule } from 'jantix';
import { Option } from 'funfix-core';
import { UnimplementedError } from 'ameo-utils';

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
  min: -1000,
  max: 1000,
  value: 0,
});

export const buildDefaultControl = (name: string): Control => ({
  data: buildDefaultControlState(),
  label: name,
  color: '#361',
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
  node: ConstantSourceNode;
  control: Control;
}

export interface ControlPanelInstanceState {
  connections: ControlPanelConnection[];
}

const initialState: ControlPanelState = { stateByPanelInstance: {} };

const ctx = new AudioContext();

const setInstance = (
  instanceVcId: string,
  newInstance: ControlPanelInstanceState,
  state: ControlPanelState
): ControlPanelState => ({
  stateByPanelInstance: { ...state.stateByPanelInstance, [instanceVcId]: newInstance },
});

const mapConnection = (
  instanceVcId: string,
  vcId: string,
  name: string,
  mapper: (conn: ControlPanelConnection) => ControlPanelConnection,
  state: ControlPanelState
): ControlPanelState => {
  const instance = state.stateByPanelInstance[instanceVcId];

  return setInstance(
    instanceVcId,
    {
      ...instance,
      connections: instance.connections.map(conn => {
        if (conn.vcId === vcId && conn.name === name) {
          return mapper(conn);
        }
        return conn;
      }),
    },
    state
  );
};

const updateControlData = (data: ControlInfo, newValue: number): ControlInfo => {
  switch (data.type) {
    case 'gate': {
      return { type: 'gate', value: newValue, isPressed: newValue !== 0 };
    }
    case 'range': {
      return { ...data, value: newValue };
    }
    default:
      throw new UnimplementedError(`Unhandled input type: ${(data as any).type}`);
  }
};

const actionGroups = {
  ADD_INSTANCE: buildActionGroup({
    actionCreator: (vcId: string, initialConnections?: Omit<ControlPanelConnection, 'node'>[]) => ({
      type: 'ADD_INSTANCE',
      vcId,
      initialConnections,
    }),
    subReducer: (state: ControlPanelState, { vcId, initialConnections }) => {
      const connections = initialConnections
        ? initialConnections.map(conn => {
            const node = new ConstantSourceNode(ctx);
            node.offset.value = conn.control.data.value;
            node.start();

            return { ...conn, node };
          })
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
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name }) => {
      const node = new ConstantSourceNode(ctx);
      node.offset.value = 0;
      node.start();

      return {
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
                node,
                control: buildDefaultControl(name),
              },
            ],
          },
        },
      };
    },
  }),
  REMOVE_CONNECTION: buildActionGroup({
    actionCreator: (controlPanelVcId: string, vcId: string, name: string) => ({
      type: 'REMOVE_CONNECTION',
      controlPanelVcId,
      vcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name }) => {
      const instance = state.stateByPanelInstance[controlPanelVcId];
      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            ...instance,
            connections: instance.connections.filter(
              conn => conn.vcId !== vcId && conn.name !== name
            ),
          },
        },
      };
    },
  }),
  SET_CONTROL_POSITION: buildActionGroup({
    actionCreator: (
      controlPanelVcId: string,
      vcId: string,
      name: string,
      position: { left?: number; top?: number }
    ) => ({ type: 'SET_CONTROL_POSITION', controlPanelVcId, vcId, name, position }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name, position }) =>
      mapConnection(
        controlPanelVcId,
        vcId,
        name,
        conn => ({
          ...conn,
          control: {
            ...conn.control,
            position: {
              x: Option.of(position.left).getOrElse(10),
              y: Option.of(position.top).getOrElse(10),
            },
          },
        }),
        state
      ),
  }),
  SET_CONTROL_LABEL: buildActionGroup({
    actionCreator: (controlPanelVcId: string, vcId: string, name: string, label: string) => ({
      type: 'SET_CONTROL_LABEL',
      controlPanelVcId,
      vcId,
      name,
      label,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name, label }) =>
      mapConnection(
        controlPanelVcId,
        vcId,
        name,
        (conn: ControlPanelConnection) => ({ ...conn, control: { ...conn.control, label } }),
        state
      ),
  }),
  SET_CONTROL_PANEL_VALUE: buildActionGroup({
    actionCreator: (controlPanelVcId: string, vcId: string, name: string, value: number) => ({
      type: 'SET_CONTROL_PANEL_VALUE',
      controlPanelVcId,
      vcId,
      name,
      value,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name, value }) =>
      mapConnection(
        controlPanelVcId,
        vcId,
        name,
        (conn: ControlPanelConnection) => {
          const newData = updateControlData(conn.control.data, value);
          conn.node.offset.setValueAtTime(newData.value, ctx.currentTime);

          return {
            ...conn,
            control: { ...conn.control, data: newData },
          };
        },
        state
      ),
  }),
};

export default buildModule<ControlPanelState, typeof actionGroups>(initialState, actionGroups);