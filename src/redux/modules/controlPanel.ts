import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';

import { buildControlPanelAudioConnectables } from 'src/controlPanel/getConnectables';
import type { ConnectableDescriptor } from 'src/patchNetwork';
import { connect, updateConnectables } from 'src/patchNetwork/interface';
import { MIDINode } from 'src/patchNetwork/midiNode';
import { getState } from 'src/redux';

export interface ControlPanelState {
  stateByPanelInstance: {
    [controlPanelVcId: string]: ControlPanelInstanceState;
  };
}

export type ControlInfo =
  | { type: 'range'; min: number; max: number; width?: number; scale?: 'log' }
  | { type: 'gate'; offValue: number; gateValue: number; width?: number };

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

export const maybeSnapToGrid = (
  pos: { x: number; y: number },
  snapToGrid: boolean
): { x: number; y: number } => {
  if (!snapToGrid) {
    return pos;
  }

  const snap = (v: number, grid: number) => Math.round(v / grid) * grid;
  return {
    x: snap(pos.x, 10),
    y: snap(pos.y, 10),
  };
};

export const buildDefaultControl = (type: ControlInfo['type'] = 'range'): Control => ({
  data: buildDefaultControlPanelInfo(type),
  value: 0,
  color: '#361', // TODO: Random color or something out of a scale would be cool
  position: { x: window.innerWidth / 2 - 300, y: window.innerHeight / 2 - Math.random() * 300 },
});

export interface Control {
  data: ControlInfo;
  value: number;
  color: string;
  position: { x: number; y: number };
}

export interface ControlPanelConnection {
  vcId: string;
  name: string;
  node: ConstantSourceNode;
  control: Control;
}

export interface ControlPanelMidiKeyboardDescriptor {
  octaveOffset: number;
  position: { x: number; y: number };
  name: string;
  midiNode: MIDINode;
}

export type ControlPanelVisualizationDescriptor =
  | { type: 'oscilloscope'; position: { x: number; y: number }; name: string }
  | {
      type: 'spectrogram';
      position: { x: number; y: number };
      name: string;
      analyser: AnalyserNode;
    }
  | {
      type: 'note';
      position: { x: number; y: number };
      name: string;
      title: string;
      content: string;
      markdown: boolean;
      style: { fontSize: number; width: number; height: number };
    };

export type SerializedControlPanelVisualizationDescriptor =
  | { type: 'oscilloscope'; position: { x: number; y: number }; name: string }
  | { type: 'spectrogram'; position: { x: number; y: number }; name: string }
  | Extract<ControlPanelVisualizationDescriptor, { type: 'note' }>;

const buildDefaultVizDescriptor = (
  vizType: ControlPanelVisualizationDescriptor['type'],
  name: string
): ControlPanelVisualizationDescriptor => {
  const position = { x: 300, y: 300 + Math.random() * 200 };

  switch (vizType) {
    case 'note':
      return {
        name,
        position,
        type: vizType,
        content: 'Double-click to edit note',
        markdown: false,
        title: 'note',
        style: { width: 300, height: 200, fontSize: 14 },
      };
    case 'oscilloscope':
      return { name, position, type: vizType };
    case 'spectrogram':
      return {
        name,
        position,
        type: vizType,
        analyser: ctx.createAnalyser(),
      };
  }
};

export const serializeControlPanelVisualizationDescriptor = (
  viz: ControlPanelVisualizationDescriptor
): SerializedControlPanelVisualizationDescriptor => {
  switch (viz.type) {
    case 'oscilloscope':
      return {
        type: 'oscilloscope',
        position: viz.position,
        name: viz.name,
      };
    case 'spectrogram':
      return {
        type: 'spectrogram',
        position: viz.position,
        name: viz.name,
      };
    case 'note':
      return viz;
  }
};

export const deserializeControlPanelVisualizationDescriptor = (
  viz: SerializedControlPanelVisualizationDescriptor
): ControlPanelVisualizationDescriptor => {
  switch (viz.type) {
    case 'oscilloscope':
      return viz;
    case 'spectrogram':
      return {
        ...viz,
        analyser: ctx.createAnalyser(),
      };
    case 'note':
      return viz;
  }
};

export interface ControlPanelInstanceState {
  controls: ControlPanelConnection[];
  midiKeyboards: ControlPanelMidiKeyboardDescriptor[];
  visualizations: ControlPanelVisualizationDescriptor[];
  presets: {
    name: string;
    midiKeyboards: ControlPanelMidiKeyboardDescriptor[];
    visualizations: SerializedControlPanelVisualizationDescriptor[];
    controls: Omit<ControlPanelConnection, 'node'>[];
    snapToGrid: boolean;
  }[];
  snapToGrid: boolean;
  hidden: boolean;
  isEditing: boolean;
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

const setControlNameSubReducer = (
  state: ControlPanelState,
  { controlPanelVcId, name, newName }: { controlPanelVcId: string; name: string; newName: string }
) => {
  if (name === newName) {
    return state;
  }

  const instState = state.stateByPanelInstance[controlPanelVcId];
  if (instState.controls.some(conn => conn.name === newName)) {
    alert('Control name already exists: ' + newName);
    return state;
  }

  const controlIx = instState.controls.findIndex(conn => conn.name === name);
  if (controlIx === -1) {
    console.error('Could not find control to rename: ', { controlPanelVcId, name });
    return state;
  }

  const newControls = [...instState.controls];
  newControls[controlIx] = { ...newControls[controlIx], name: newName };

  const newInstState = { ...instState, controls: newControls };
  setTimeout(() => {
    const oldName = name;
    const allConnectedDestinations = getState().viewContextManager.patchNetwork.connections.filter(
      ([from, _to]) => from.vcId === controlPanelVcId && from.name === oldName
    );

    // Updating connectables will disconnect everything connected to the output
    updateConnectables(
      controlPanelVcId,
      buildControlPanelAudioConnectables(controlPanelVcId, newInstState)
    );

    // Re-connect everything to the output with the new name
    const newFromDescriptor: ConnectableDescriptor = { vcId: controlPanelVcId, name: newName };
    allConnectedDestinations.forEach(([_from, to]) => {
      connect(newFromDescriptor, to);
    });
  });

  return {
    ...state,
    stateByPanelInstance: {
      ...state.stateByPanelInstance,
      [controlPanelVcId]: newInstState,
    },
  };
};

const actionGroups = {
  ADD_CONTROL_PANEL_INSTANCE: buildActionGroup({
    actionCreator: (
      vcId: string,
      initialConnections?: Omit<ControlPanelConnection, 'node'>[],
      initialMidiKeyboards?: ControlPanelMidiKeyboardDescriptor[],
      initialVisualizations?: ControlPanelVisualizationDescriptor[],
      presets?: ControlPanelInstanceState['presets'],
      snapToGrid?: boolean,
      isEditing?: boolean
    ) => ({
      type: 'ADD_CONTROL_PANEL_INSTANCE',
      vcId,
      initialConnections,
      initialMidiKeyboards,
      initialVisualizations,
      presets,
      snapToGrid,
      isEditing,
    }),
    subReducer: (
      state: ControlPanelState,
      {
        vcId,
        initialConnections,
        initialMidiKeyboards,
        initialVisualizations,
        presets,
        snapToGrid,
        isEditing,
      }
    ) => {
      const connections = initialConnections ? initialConnections.map(hydrateConnection) : [];

      const instState: ControlPanelInstanceState = {
        controls: connections,
        midiKeyboards: initialMidiKeyboards ?? [],
        visualizations: initialVisualizations ?? [],
        presets: presets ?? [],
        snapToGrid: snapToGrid ?? false,
        hidden: false,
        isEditing: isEditing ?? true,
      };

      return {
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [vcId]: instState,
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
  ADD_CONTROL_PANEL_CONNECTION: buildActionGroup({
    actionCreator: (
      controlPanelVcId: string,
      vcId: string,
      name: string,
      controlType?: ControlInfo['type']
    ) => ({
      type: 'ADD_CONTROL_PANEL_CONNECTION',
      controlPanelVcId,
      vcId,
      name,
      controlType,
    }),
    subReducer: (
      state: ControlPanelState,
      { controlPanelVcId, vcId, name: providedName, controlType }
    ) => {
      const node = new ConstantSourceNode(ctx);
      node.offset.value = 0;
      node.start();

      let name = providedName;
      let i = 1;
      while (
        state.stateByPanelInstance[controlPanelVcId].controls.some(conn => conn.name === name)
      ) {
        name = `${providedName} ${i}`;
        i += 1;
      }

      const newInstState = {
        ...state.stateByPanelInstance[controlPanelVcId],
        controls: [
          ...state.stateByPanelInstance[controlPanelVcId].controls,
          {
            vcId,
            name,
            node,
            control: buildDefaultControl(controlType),
          },
        ],
      };

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: newInstState,
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

      const newInstState = { ...instance, controls: retainedConns };
      setTimeout(() =>
        updateConnectables(
          controlPanelVcId,
          buildControlPanelAudioConnectables(controlPanelVcId, newInstState)
        )
      );

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: newInstState,
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
    subReducer: (state: ControlPanelState, { controlPanelVcId, vcId, name, position }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return mapConnection(
        controlPanelVcId,
        vcId,
        name,
        conn => ({
          ...conn,
          control: {
            ...conn.control,
            position: maybeSnapToGrid(
              {
                x: position.left ?? 10,
                y: position.top ?? 10,
              },
              instState.snapToGrid
            ),
          },
        }),
        state
      );
    },
  }),
  SET_CONTROL_NAME: buildActionGroup({
    actionCreator: (controlPanelVcId: string, vcId: string, name: string, newName: string) => ({
      type: 'SET_CONTROL_NAME',
      controlPanelVcId,
      vcId,
      name,
      newName,
    }),
    subReducer: (state: ControlPanelState, action) => setControlNameSubReducer(state, action),
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
    actionCreator: (
      controlPanelVcId: string,
      vcId: string,
      name: string,
      newControl: Control,
      newName: string
    ) => ({
      type: 'SET_CONTROL_PANEL_CONTROL',
      controlPanelVcId,
      vcId,
      name,
      newControl,
      newName,
    }),
    subReducer: (
      state: ControlPanelState,
      { controlPanelVcId, vcId, name, newControl, newName }
    ) => {
      const maybeRenamedState =
        name === newName
          ? state
          : setControlNameSubReducer(state, { controlPanelVcId, name, newName });

      return mapConnection(
        controlPanelVcId,
        vcId,
        newName,
        conn => ({ ...conn, control: newControl }),
        maybeRenamedState
      );
    },
  }),
  SAVE_PRESET: buildActionGroup({
    actionCreator: (controlPanelVcId: string, name: string) => ({
      type: 'SAVE_PRESET',
      controlPanelVcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name }): ControlPanelState => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return {
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            ...instState,
            presets: [
              ...instState.presets,
              {
                name,
                midiKeyboards: instState.midiKeyboards,
                visualizations: instState.visualizations,
                controls: instState.controls.map(R.omit(['node'])),
                snapToGrid: instState.snapToGrid,
              },
            ],
          },
        },
      };
    },
  }),
  LOAD_PRESET: buildActionGroup({
    actionCreator: (controlPanelVcId: string, name: string) => ({
      type: 'LOAD_PRESET' as const,
      controlPanelVcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name }): ControlPanelState => {
      const instanceState = state.stateByPanelInstance[controlPanelVcId];
      const preset = instanceState.presets.find(preset => preset.name === name);
      if (!preset) {
        console.error(`Tried to load preset named ${name} but it wasn't found`);
        return state;
      }

      return {
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            presets: instanceState.presets,
            midiKeyboards: preset.midiKeyboards,
            visualizations: preset.visualizations.map(
              deserializeControlPanelVisualizationDescriptor
            ),
            controls: preset.controls.map(hydrateConnection),
            snapToGrid: preset.snapToGrid,
            hidden: false,
            isEditing: false,
          },
        },
      };
    },
  }),
  DELETE_PRESET: buildActionGroup({
    actionCreator: (controlPanelVcId: string, name: string) => ({
      type: 'DELETE_PRESET' as const,
      controlPanelVcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name }) => ({
      ...state,
      stateByPanelInstance: {
        ...state.stateByPanelInstance,
        [controlPanelVcId]: {
          ...state.stateByPanelInstance[controlPanelVcId],
          presets: state.stateByPanelInstance[controlPanelVcId].presets.filter(
            preset => preset.name !== name
          ),
        },
      },
    }),
  }),
  ADD_CONTROL_PANEL_MIDI_KEYBOARD: buildActionGroup({
    actionCreator: (controlPanelVcId: string) => ({
      type: 'ADD_CONTROL_PANEL_MIDI_KEYBOARD' as const,
      controlPanelVcId,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      let name = `midi keyboard ${instState.midiKeyboards.length + 1}`;
      while (instState.midiKeyboards.some(R.propEq(name, 'name'))) {
        name = `midi keyboard ${instState.midiKeyboards.length + 1}`;
      }

      const newKb: ControlPanelMidiKeyboardDescriptor = {
        name,
        octaveOffset: 0,
        position: { x: 300, y: 300 + Math.random() * 200 },
        midiNode: new MIDINode(),
      };

      const newInstState = { ...instState, midiKeyboards: [...instState.midiKeyboards, newKb] };
      setTimeout(() =>
        updateConnectables(
          controlPanelVcId,
          buildControlPanelAudioConnectables(controlPanelVcId, newInstState)
        )
      );

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: newInstState,
        },
      };
    },
  }),
  DELETE_CONTROL_PANEL_MIDI_KEYBOARD: buildActionGroup({
    actionCreator: (controlPanelVcId: string, name: string) => ({
      type: 'DELETE_CONTROL_PANEL_MIDI_KEYBOARD' as const,
      controlPanelVcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      const newInstState = {
        ...instState,
        midiKeyboards: instState.midiKeyboards.filter(keyboard => keyboard.name !== name),
      };
      setTimeout(() =>
        updateConnectables(
          controlPanelVcId,
          buildControlPanelAudioConnectables(controlPanelVcId, newInstState)
        )
      );

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: newInstState,
        },
      };
    },
  }),
  UPDATE_CONTROL_PANEL_MIDI_KEYBOARD: buildActionGroup({
    actionCreator: (
      controlPanelVcId: string,
      name: string,
      newProps: Partial<ControlPanelMidiKeyboardDescriptor>
    ) => ({
      type: 'UPDATE_CONTROL_PANEL_MIDI_KEYBOARD' as const,
      controlPanelVcId,
      name,
      newProps,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name, newProps }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            ...instState,
            midiKeyboards: instState.midiKeyboards.map(keyboard => {
              if (keyboard.name !== name) {
                return keyboard;
              }

              return { ...keyboard, ...newProps };
            }),
          },
        },
      };
    },
  }),
  SET_CONTROL_PANEL_SNAP_TO_GRID: buildActionGroup({
    actionCreator: (controlPanelVcId: string, snapToGrid: boolean) => ({
      type: 'SET_CONTROL_PANEL_SNAP_TO_GRID' as const,
      controlPanelVcId,
      snapToGrid,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, snapToGrid }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: { ...instState, snapToGrid },
        },
      };
    },
  }),
  ADD_CONTROL_PANEL_VIZ: buildActionGroup({
    actionCreator: (
      controlPanelVcId: string,
      vizType: ControlPanelVisualizationDescriptor['type']
    ) => ({
      type: 'ADD_CONTROL_PANEL_VIZ' as const,
      controlPanelVcId,
      vizType,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vizType }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      let name = `${vizType} ${instState.visualizations.length + 1}`;
      while (instState.visualizations.some(R.propEq(name, 'name'))) {
        name = `${vizType} ${instState.visualizations.length + 1}`;
      }

      const newViz: ControlPanelVisualizationDescriptor = buildDefaultVizDescriptor(vizType, name);

      const newInstState = { ...instState, visualizations: [...instState.visualizations, newViz] };
      setTimeout(() =>
        updateConnectables(
          controlPanelVcId,
          buildControlPanelAudioConnectables(controlPanelVcId, newInstState)
        )
      );

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: newInstState,
        },
      };
    },
  }),
  SET_CONTROL_PANEL_VIZ_POS: buildActionGroup({
    actionCreator: (
      controlPanelVcId: string,
      vizName: string,
      newPos: { x: number; y: number }
    ) => ({
      type: 'SET_CONTROL_PANEL_VIZ_POS' as const,
      controlPanelVcId,
      vizName,
      newPos,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vizName, newPos }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            ...instState,
            visualizations: instState.visualizations.map(viz => {
              if (viz.name !== vizName) {
                return viz;
              }

              return { ...viz, position: maybeSnapToGrid(newPos, instState.snapToGrid) };
            }),
          },
        },
      };
    },
  }),
  UPDATE_CONTROL_PANEL_VIZ: buildActionGroup({
    actionCreator: (
      controlPanelVcId: string,
      vizName: string,
      newViz: ControlPanelVisualizationDescriptor
    ) => ({
      type: 'UPDATE_CONTROL_PANEL_VIZ' as const,
      controlPanelVcId,
      vizName,
      newViz,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, vizName, newViz }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: {
            ...instState,
            visualizations: instState.visualizations.map(viz => {
              if (viz.name !== vizName) {
                return viz;
              }

              return newViz;
            }),
          },
        },
      };
    },
  }),
  DELETE_CONTROL_PANEL_VIZ: buildActionGroup({
    actionCreator: (controlPanelVcId: string, name: string) => ({
      type: 'DELETE_CONTROL_PANEL_VIZ' as const,
      controlPanelVcId,
      name,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, name }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      const newInstState = {
        ...instState,
        visualizations: instState.visualizations.filter(viz => viz.name !== name),
      };
      setTimeout(() =>
        updateConnectables(
          controlPanelVcId,
          buildControlPanelAudioConnectables(controlPanelVcId, newInstState)
        )
      );

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: newInstState,
        },
      };
    },
  }),
  SET_CONTROL_PANEL_HIDDEN: buildActionGroup({
    actionCreator: (controlPanelVcId: string, hidden: boolean) => ({
      type: 'SET_CONTROL_PANEL_HIDDEN' as const,
      controlPanelVcId,
      hidden,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, hidden }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: { ...instState, hidden },
        },
      };
    },
  }),
  SET_CONTROL_PANEL_IS_EDITING: buildActionGroup({
    actionCreator: (controlPanelVcId: string, isEditing: boolean) => ({
      type: 'SET_CONTROL_PANEL_IS_EDITING' as const,
      controlPanelVcId,
      isEditing,
    }),
    subReducer: (state: ControlPanelState, { controlPanelVcId, isEditing }) => {
      const instState = state.stateByPanelInstance[controlPanelVcId];

      return {
        ...state,
        stateByPanelInstance: {
          ...state.stateByPanelInstance,
          [controlPanelVcId]: { ...instState, isEditing },
        },
      };
    },
  }),
};

export default buildModule<ControlPanelState, typeof actionGroups>(initialState, actionGroups);
