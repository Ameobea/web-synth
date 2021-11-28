import { Option } from 'funfix-core';
import { Map as ImmMap } from 'immutable';
import * as R from 'ramda';

import { actionCreators, dispatch, getState, store } from 'src/redux';
import ControlPanelUI from 'src/controlPanel/ControlPanelUI';
import type { AudioConnectables, ConnectableDescriptor, ConnectableOutput } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import './ControlPanel.scss';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import {
  ControlPanelInstanceState,
  ControlPanelConnection,
  buildDefaultControl,
  ControlPanelMidiKeyboardDescriptor,
} from 'src/redux/modules/controlPanel';
import {
  mkContainerCleanupHelper,
  mkContainerHider,
  mkContainerRenderHelper,
  mkContainerUnhider,
} from 'src/reactUtils';
import { MIDINode } from 'src/patchNetwork/midiNode';

const ctx = new AudioContext();
const BASE_ROOT_NODE_ID = 'control-panel-root-node';
const getRootNodeID = (vcId: string) => `${BASE_ROOT_NODE_ID}${vcId}`;

interface SerializedControlPanelState {
  connections: Omit<ControlPanelConnection, 'node'>[];
  midiKeyboards: Omit<ControlPanelMidiKeyboardDescriptor, 'midiNode'>[];
  presets: ControlPanelInstanceState['presets'];
  snapToGrid: boolean;
}

const saveStateForInstance = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const instanceState = getState().controlPanel.stateByPanelInstance[vcId];
  const serializableConnections = instanceState.controls.map(conn =>
    R.omit(['node' as const], conn)
  );

  const serialized: SerializedControlPanelState = {
    connections: serializableConnections,
    midiKeyboards: instanceState.midiKeyboards,
    presets: instanceState.presets,
    snapToGrid: instanceState.snapToGrid ?? false,
  };

  const serializedConnections = JSON.stringify(serialized);
  localStorage.setItem(stateKey, serializedConnections);
};

export const init_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.createElement('div');
  rootNode.className = 'control-panel-root-node';
  rootNode.id = getRootNodeID(vcId);
  document.getElementById('content')!.append(rootNode);

  const serialized = Option.of(localStorage.getItem(stateKey))
    .flatMap(serialized => {
      try {
        const { connections, presets, midiKeyboards, snapToGrid }: SerializedControlPanelState =
          JSON.parse(serialized);
        return Option.some({
          connections: connections.map(conn => {
            if (!conn.control) {
              conn.control = buildDefaultControl();
            }
            return conn as ControlPanelConnection;
          }),
          midiKeyboards: (midiKeyboards ?? []).map(kb => ({ ...kb, midiNode: new MIDINode() })),
          presets: presets ?? [],
          snapToGrid: snapToGrid ?? false,
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
      serialized?.presets,
      serialized?.snapToGrid ?? false
    )
  );

  mkContainerRenderHelper({ Comp: ControlPanelUI, getProps: () => ({ stateKey }), store })(
    getRootNodeID(vcId)
  );
};

export const hide_control_panel = mkContainerHider(getRootNodeID);

export const unhide_control_panel = mkContainerUnhider(getRootNodeID);

export const cleanup_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.getElementById(getRootNodeID(vcId));

  saveStateForInstance(stateKey);
  if (rootNode) {
    mkContainerCleanupHelper()(getRootNodeID(vcId));
  }

  dispatch(actionCreators.controlPanel.REMOVE_INSTANCE(vcId));
};

export class PlaceholderInput extends GainNode implements AudioNode {
  private controlPanelVcId: string;

  constructor(ctx: AudioContext, controlPanelVcId: string) {
    super(ctx);
    this.controlPanelVcId = controlPanelVcId;
  }

  connect(
    destinationNode: AudioNode | AudioParam,
    outputNumOrDescriptor?: number | ConnectableDescriptor,
    _input?: number
  ) {
    if (destinationNode instanceof OverridableAudioParam) {
      destinationNode.setIsOverridden(true);
    }
    if (!outputNumOrDescriptor || typeof outputNumOrDescriptor === 'number') {
      throw new Error(
        'Must provide `ConnectableDescriptor` as second argument to `connect` for `PlaceholderInput`'
      );
    }
    const dstDescriptor = outputNumOrDescriptor;

    setTimeout(() => {
      // Disconnect from the dummy "add a new control", create a new input for it, and re-connect it to that

      dispatch(
        actionCreators.viewContextManager.DISCONNECT(
          { vcId: this.controlPanelVcId, name: 'Add a new control...' },
          dstDescriptor
        )
      );

      let outputName = dstDescriptor.name;
      while (
        getState().controlPanel.stateByPanelInstance[this.controlPanelVcId].controls.some(
          control => control.name === outputName
        )
      ) {
        outputName += '_1';
      }

      dispatch(
        actionCreators.controlPanel.ADD_CONNECTION(
          this.controlPanelVcId,
          dstDescriptor.vcId,
          outputName
        )
      );
      updateConnectables(
        this.controlPanelVcId,
        get_control_panel_audio_connectables(`controlPanel_${this.controlPanelVcId}`)
      );
      dispatch(
        actionCreators.viewContextManager.CONNECT(
          { vcId: this.controlPanelVcId, name: outputName },
          dstDescriptor
        )
      );
    });

    return destinationNode as any;
  }

  disconnect(..._args: any) {
    // no-op
  }
}

export const buildControlPanelAudioConnectables = (
  vcId: string,
  instState: ControlPanelInstanceState
): AudioConnectables => {
  let existingConnections = instState.controls.reduce(
    (acc, conn) => acc.set(conn.name, { type: 'number', node: conn.node }),
    ImmMap() as ImmMap<string, ConnectableOutput>
  );
  existingConnections = instState.midiKeyboards.reduce(
    (acc, conn) => acc.set(conn.name, { type: 'midi', node: conn.midiNode }),
    existingConnections
  );

  const outputs = existingConnections.set('Add a new control...', {
    type: 'number',
    node: new PlaceholderInput(ctx, vcId),
  });

  return {
    vcId,
    inputs: ImmMap(),
    outputs,
  };
};

export const get_control_panel_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1];
  const instanceState = getState().controlPanel.stateByPanelInstance[vcId];
  return buildControlPanelAudioConnectables(vcId, instanceState);
};
