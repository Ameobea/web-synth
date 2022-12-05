import { UnimplementedError } from 'ameo-utils';
import { Map as ImmMap } from 'immutable';

import { PlaceholderInput } from 'src/controlPanel/PlaceholderInput';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import type { ControlPanelInstanceState } from 'src/redux/modules/controlPanel';

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
    node: new PlaceholderInput(ctx, vcId),
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
