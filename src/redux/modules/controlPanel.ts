import { buildActionGroup, buildModule } from 'jantix';
import { Option } from 'funfix-core';
import * as R from 'ramda';

export interface ControlPanelState {
  stateByPanelInstance: {
    [controlPanelVcId: string]: ControlPanelInstanceState;
  };
}

export type ControlInfo =
  | { type: 'range'; min: number; max: number }
  | { type: 'gate'; offValue: number; gateValue: number };

export const buildDefaultControlPanelInfo = (type: ControlInfo['type'] = 'range'): ControlInfo => {
  switch (type) {
    case 'range':
      return {
        type: 'range',
        min: -1000,
        max: 1000,
      };
    case 'gate':
      return {
        type: 'gate',
        offValue: 0.0,
        gateValue: 1.0,
      };
  }
};

export const buildDefaultControl = (name: string): Control => ({
  data: buildDefaultControlPanelInfo(),
  value: 0,
  label: name,
  color: '#361',
  position: { x: 0, y: 0 },
});

export interface Control {
  data: ControlInfo;
  value: number;
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
  controls: ControlPanelConnection[];
  presets: {
    name: string;
    controls: Omit<ControlPanelConnection, 'node'>[];
  }[];
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
      controls: instance.controls.map(conn => {
        if (conn.vcId === vcId && conn.name === name) {
          return mapper(conn);
        }
        return conn;
      }),
    },
    state
  );
};

const hydrateConnection = (conn: Omit<ControlPanelConnection, 'node'>): ControlPanelConnection => {
  const node = new ConstantSourceNode(ctx);
  node.offset.value = conn.control.value;
  node.start();

  return { ...conn, node };
};

const disconnectControl = (control: ControlPanelConnection) => control.node.disconnect();

const actionGroups = {
  ADD_INSTANCE: buildActionGroup({
    actionCreator: (
      vcId: string,
      initialConnections?: Omit<ControlPanelConnection, 'node'>[],
      presets?: { name: string; controls: Omit<ControlPanelConnection, 'node'>[] }[]
    ) => ({
      type: 'ADD_INSTANCE',
      vcId,
      initialConnections,
      presets,
    }),
    subReducer: (state: ControlPanelState, { vcId, initialConnections, presets }) => {
      const connections = initialConnections ? initialConnections.map(hydrateConnection) : [];

      return {
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [vcId]: {
            controls: connections,
            presets: presets || [],
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
            controls: [
              ...state.stateByPanelInstance[controlPanelVcId].controls,
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
      const [removedConns, retainedConns] = R.partition(
        conn => conn.vcId === vcId && conn.name === name,
        instance.controls
      );
      if (removedConns.length !== 1) {
        console.error('Expected to find one conn to remove, found these: ', removedConns);
      }
      removedConns.forEach(disconnectControl);

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            ...instance,
            controls: retainedConns,
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
          conn.node.offset.setValueAtTime(value, ctx.currentTime);

          return {
            ...conn,
            control: { ...conn.control, value },
          };
        },
        state
      ),
  }),
  SET_CONTROL_PANEL_CONTROL: buildActionGroup({
    actionCreator: (controlPanelVcId: string, vcId: string, name: string, newControl: Control) => ({
      type: 'SET_CONTROL_PANEL_CONTROL',
      controlPanelVcId,
      vcId,
      name,
      newControl,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name, newControl }) =>
      mapConnection(
        controlPanelVcId,
        vcId,
        name,
        conn => ({ ...conn, control: newControl }),
        state
      ),
  }),
  SAVE_PRESET: buildActionGroup({
    actionCreator: (controlPanelVcId: string, name: string) => ({
      type: 'SAVE_PRESET',
      controlPanelVcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name }): ControlPanelState => ({
      stateByPanelInstance: {
        ...state.stateByPanelInstance,
        [controlPanelVcId]: {
          ...state.stateByPanelInstance[controlPanelVcId],
          presets: [
            ...state.stateByPanelInstance[controlPanelVcId].presets,
            {
              name,
              controls: state.stateByPanelInstance[controlPanelVcId].controls.map(R.omit(['node'])),
            },
          ],
        },
      },
    }),
  }),
  LOAD_PRESET: buildActionGroup({
    actionCreator: (controlPanelVcId: string, name: string) => ({
      type: 'LOAD_PRESET',
      controlPanelVcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name }): ControlPanelState => {
      const instanceState = state.stateByPanelInstance[controlPanelVcId];
      const preset = instanceState.presets.find(R.propEq('name' as const, name));
      if (!preset) {
        console.error(`Tried to load preset named ${name} but it wasn't found`);
        return state;
      }

      // Disconnect all of the old controls and build new ones
      instanceState.controls.forEach(disconnectControl);

      return {
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            presets: instanceState.presets,
            controls: preset.controls.map(hydrateConnection),
          },
        },
      };
    },
  }),
};

export default buildModule<ControlPanelState, typeof actionGroups>(initialState, actionGroups);
