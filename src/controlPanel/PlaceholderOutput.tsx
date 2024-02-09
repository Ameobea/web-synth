import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableDescriptor, ConnectableType } from 'src/patchNetwork';
import { updateConnectables } from 'src/patchNetwork/interface';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import { actionCreators, dispatch, getState } from 'src/redux';

export class PlaceholderOutput extends GainNode implements AudioNode {
  private vcId: string;
  private getConnectables: () => AudioConnectables;
  private addOutput: (
    outputName: string,
    type: ConnectableType,
    rxConnectableDescriptor: ConnectableDescriptor
  ) => void;
  public label: string;

  constructor(
    ctx: AudioContext,
    vcId: string,
    getConnectables: () => AudioConnectables,
    addOutput: (
      outputName: string,
      type: ConnectableType,
      rxConnectableDescriptor: ConnectableDescriptor
    ) => void,
    label = 'Add a new control...'
  ) {
    super(ctx);
    this.vcId = vcId;
    this.getConnectables = getConnectables;
    this.addOutput = addOutput;
    this.label = label;
  }

  connect(
    destinationNode: AudioNode | AudioParam | MIDINode,
    inputNumOrDescriptor?: number | ConnectableDescriptor,
    _input?: number
  ) {
    if (destinationNode instanceof OverridableAudioParam) {
      destinationNode.setIsOverridden(true);
    }
    if (!inputNumOrDescriptor || typeof inputNumOrDescriptor === 'number') {
      throw new Error(
        'Must provide `ConnectableDescriptor` as second argument to `connect` for `PlaceholderOutput`'
      );
    }
    const rxDescriptor = inputNumOrDescriptor;

    setTimeout(() => {
      // Disconnect from the dummy "add a new control", create a new input for it, and re-connect it to that
      dispatch(
        actionCreators.viewContextManager.DISCONNECT(
          { vcId: this.vcId, name: this.label },
          rxDescriptor
        )
      );

      let outputName = rxDescriptor.name;
      while (
        getState()
          .viewContextManager.patchNetwork.connectables.get(this.vcId)
          ?.outputs.has(outputName)
      ) {
        outputName += '_1';
      }

      const rxConnectables = getState().viewContextManager.patchNetwork.connectables.get(
        rxDescriptor.vcId
      );
      if (!rxConnectables) {
        throw new Error(`No connectables found for vcId=${rxDescriptor.vcId}`);
      }
      const rxConnectable = rxConnectables.inputs.get(rxDescriptor.name);
      if (!rxConnectable) {
        throw new Error(
          `No input named "${rxDescriptor.name}" found for vcId=${rxDescriptor.vcId}`
        );
      }
      this.addOutput(outputName, rxConnectable.type, rxDescriptor);

      updateConnectables(this.vcId, this.getConnectables());
      dispatch(
        actionCreators.viewContextManager.CONNECT(
          { vcId: this.vcId, name: outputName },
          rxDescriptor
        )
      );
    });

    return destinationNode as any;
  }

  disconnect(..._args: any) {
    // no-op
  }
}
