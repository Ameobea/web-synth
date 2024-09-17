import { Map as ImmMap } from 'immutable';

import { PlaceholderOutput } from 'src/controlPanel/PlaceholderOutput';
import type {
  AudioConnectables,
  ConnectableDescriptor,
  ConnectableInput,
  ConnectableOutput,
  ConnectableType,
} from 'src/patchNetwork';
import { actionCreators, dispatch, getState } from 'src/redux';
import type { ControlPanelInstanceState } from 'src/redux/modules/controlPanel';
import { UnimplementedError } from 'src/util';

const ctx = new AudioContext();

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
    node: new PlaceholderOutput(
      ctx,
      vcId,
      () => {
        const instanceState = getState().controlPanel.stateByPanelInstance[vcId];
        return buildControlPanelAudioConnectables(vcId, instanceState);
      },
      (inputName: string, _type: ConnectableType, rxConnectableDescriptor: ConnectableDescriptor) =>
        void dispatch(
          actionCreators.controlPanel.ADD_CONTROL_PANEL_CONNECTION(
            vcId,
            rxConnectableDescriptor.vcId,
            inputName
          )
        )
    ),
  });

  return {
    vcId,
    inputs: instState.visualizations.reduce((acc, viz) => {
      switch (viz.type) {
        case 'oscilloscope':
          throw new UnimplementedError();
        case 'spectrogram':
          return acc.set(viz.name, { type: 'customAudio', node: viz.analyser });
        case 'note':
          return acc;
        default:
          throw new Error(`Unknown viz type: ${(viz as any).type}`);
      }
    }, ImmMap<string, ConnectableInput>()),
    outputs,
  };
};
