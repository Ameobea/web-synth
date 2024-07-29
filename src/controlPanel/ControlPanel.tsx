import { Option } from 'funfix-core';
import * as R from 'ramda';
import React, { Suspense } from 'react';

import './ControlPanel.css';
import { buildControlPanelAudioConnectables } from 'src/controlPanel/getConnectables';
import Loading from 'src/misc/Loading';
import type { AudioConnectables } from 'src/patchNetwork';
import { MIDINode } from 'src/patchNetwork/midiNode';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import { actionCreators, dispatch, getState, store } from 'src/redux';
import {
  buildDefaultControl,
  deserializeControlPanelVisualizationDescriptor,
  serializeControlPanelVisualizationDescriptor,
  type ControlPanelConnection,
  type ControlPanelInstanceState,
  type ControlPanelMidiKeyboardDescriptor,
  type SerializedControlPanelVisualizationDescriptor,
} from 'src/redux/modules/controlPanel';

const BASE_ROOT_NODE_ID = 'control-panel-root-node';
const getRootNodeID = (vcId: string) => `${BASE_ROOT_NODE_ID}${vcId}`;

interface SerializedControlPanelState {
  connections: Omit<ControlPanelConnection, 'node'>[];
  midiKeyboards: Omit<ControlPanelMidiKeyboardDescriptor, 'midiNode'>[];
  visualizations: SerializedControlPanelVisualizationDescriptor[];
  presets: ControlPanelInstanceState['presets'];
  snapToGrid: boolean;
  isEditing: boolean;
}

const saveStateForInstance = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const instanceState = getState().controlPanel.stateByPanelInstance[vcId];
  const serializableConnections = instanceState.controls.map(conn =>
    R.omit(['node' as const], conn)
  );

  const serialized: SerializedControlPanelState = {
    connections: serializableConnections,
    midiKeyboards: instanceState.midiKeyboards.map(mkb => R.omit(['midiNode' as const], mkb)),
    visualizations: instanceState.visualizations.map(serializeControlPanelVisualizationDescriptor),
    presets: instanceState.presets,
    snapToGrid: instanceState.snapToGrid ?? false,
    isEditing: instanceState.isEditing,
  };

  const serializedConnections = JSON.stringify(serialized);
  localStorage.setItem(stateKey, serializedConnections);
};
const LazyControlPanelUI = React.lazy(() => import('src/controlPanel/ControlPanelUI'));
const ControlPanelUI: React.FC<{ stateKey: string }> = ({ stateKey }) => (
  <Suspense fallback={<Loading />}>
    <LazyControlPanelUI stateKey={stateKey} />
  </Suspense>
);

export const init_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.createElement('div');
  rootNode.className = 'control-panel-root-node';
  rootNode.id = getRootNodeID(vcId);
  document.getElementById('content')!.append(rootNode);

  const serialized = Option.of(localStorage.getItem(stateKey))
    .flatMap(serialized => {
      try {
        const {
          connections,
          presets,
          midiKeyboards,
          visualizations,
          snapToGrid,
          isEditing,
        }: SerializedControlPanelState = JSON.parse(serialized);
        return Option.some({
          connections: connections.map(conn => {
            if (!conn.control) {
              conn.control = buildDefaultControl();
            }
            return conn as ControlPanelConnection;
          }),
          midiKeyboards: (midiKeyboards ?? []).map(kb => ({ ...kb, midiNode: new MIDINode() })),
          visualizations,
          presets: Array.isArray(presets) ? presets : [],
          snapToGrid: snapToGrid ?? false,
          isEditing: isEditing ?? true,
        });
      } catch (err) {
        console.warn('Failed to parse serialized control panel state; defaulting.');
        return Option.none();
      }
    })
    .orUndefined();
  dispatch(
    actionCreators.controlPanel.ADD_CONTROL_PANEL_INSTANCE(
      vcId,
      serialized?.connections,
      serialized?.midiKeyboards,
      serialized?.visualizations.map(deserializeControlPanelVisualizationDescriptor),
      serialized?.presets,
      serialized?.snapToGrid ?? false,
      serialized?.isEditing
    )
  );

  mkContainerRenderHelper({ Comp: ControlPanelUI, getProps: () => ({ stateKey }), store })(
    getRootNodeID(vcId)
  );
};

export const hide_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  dispatch(actionCreators.controlPanel.SET_CONTROL_PANEL_HIDDEN(vcId, true));
  mkContainerHider(getRootNodeID)(stateKey);
};

export const unhide_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  dispatch(actionCreators.controlPanel.SET_CONTROL_PANEL_HIDDEN(vcId, false));
  mkContainerUnhider(getRootNodeID)(stateKey);
};

export const cleanup_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.getElementById(getRootNodeID(vcId));

  saveStateForInstance(stateKey);
  if (rootNode) {
    mkContainerCleanupHelper()(getRootNodeID(vcId));
  }

  dispatch(actionCreators.controlPanel.REMOVE_INSTANCE(vcId));
};

export const get_control_panel_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1];
  const instanceState = getState().controlPanel.stateByPanelInstance[vcId];
  return buildControlPanelAudioConnectables(vcId, instanceState);
};
