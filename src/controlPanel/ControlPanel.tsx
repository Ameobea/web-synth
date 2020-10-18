import { UnimplementedError } from 'ameo-utils';
import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Map as ImmMap } from 'immutable';

import { store } from 'src/redux';
import ControlPanelUI from 'src/controlPanel/ControlPanelUI';
import { AudioConnectables, ConnectableOutput } from 'src/patchNetwork';
import './ControlPanel.scss';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';

const ctx = new AudioContext();
const BASE_ROOT_NODE_ID = 'control-panel-root-node';
const getRootNodeID = (vcId: string) => `${BASE_ROOT_NODE_ID}${vcId}`;

const saveStateForInstance = (stateKey: string) => {
  // TODO
};

export const init_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.createElement('div');
  rootNode.className = 'control-panel-root-node';
  rootNode.id = getRootNodeID(vcId);
  document.getElementById('content')!.append(rootNode);

  ReactDOM.render(
    <Provider store={store}>
      <ControlPanelUI stateKey={stateKey} />
    </Provider>,
    rootNode
  );
};

export const hide_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.getElementById(getRootNodeID(vcId));
  if (!rootNode) {
    console.warn(`Tried to hide control panel with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'none';
};

export const unhide_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.getElementById(getRootNodeID(vcId));
  if (!rootNode) {
    console.warn(`Tried to unhide control panel with id ${vcId} but it wasn't mounted`);
    return;
  }

  rootNode.style.display = 'block';
};

export const cleanup_control_panel = (stateKey: string) => {
  const vcId = stateKey.split('_')[1];
  const rootNode = document.getElementById(getRootNodeID(vcId));

  saveStateForInstance(stateKey);
  if (rootNode) {
    ReactDOM.unmountComponentAtNode(rootNode);
    rootNode.remove();
  }
};

export class PlaceholderInput extends GainNode implements AudioNode {
  private vcId: string;

  constructor(ctx: AudioContext, vcId: string) {
    super(ctx);
    this.vcId = vcId;
  }

  connect(
    destinationNode: AudioNode | AudioParam,
    outputNumOrName?: number | string,
    _input?: number
  ) {
    if (destinationNode instanceof OverridableAudioParam) {
      destinationNode.setIsOverridden(true);
    }

    console.log(outputNumOrName);
    // TODO
    return destinationNode as any;
  }

  disconnect(..._args: any) {
    // no-op
  }
}

export const get_control_panel_audio_connectables = (stateKey: string): AudioConnectables => {
  const vcId = stateKey.split('_')[1];
  // TODO: Get already created connections
  const existingConnections: ImmMap<string, ConnectableOutput> = ImmMap();

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
