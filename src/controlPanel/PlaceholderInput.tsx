import { buildControlPanelAudioConnectables } from 'src/controlPanel/getConnectables';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { ConnectableDescriptor } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import { actionCreators, dispatch, getState } from 'src/redux';

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
        actionCreators.controlPanel.ADD_CONTROL_PANEL_CONNECTION(
          this.controlPanelVcId,
          dstDescriptor.vcId,
          outputName
        )
      );
      const instanceState = getState().controlPanel.stateByPanelInstance[this.controlPanelVcId];
      updateConnectables(
        this.controlPanelVcId,
        buildControlPanelAudioConnectables(this.controlPanelVcId, instanceState)
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
