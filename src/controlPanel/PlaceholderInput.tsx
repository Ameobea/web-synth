import DummyNode from 'src/graphEditor/nodes/DummyNode';
import type { AudioConnectables, ConnectableDescriptor, ConnectableType } from 'src/patchNetwork';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import { actionCreators, dispatch, getState } from 'src/redux';

export class PlaceholderInput extends DummyNode {
  private vcId: string;
  private getConnectables: () => AudioConnectables;
  private addInput: (
    inputName: string,
    type: ConnectableType,
    txConnectableDescriptor: ConnectableDescriptor
  ) => void;
  public label: string;

  constructor(
    _ctx: AudioContext,
    vcId: string,
    getConnectables: () => AudioConnectables,
    addInput: (
      inputName: string,
      type: ConnectableType,
      txConnectableDescriptor: ConnectableDescriptor
    ) => void,
    label = 'Add a new input...'
  ) {
    super(label);
    this.vcId = vcId;
    this.getConnectables = getConnectables;
    this.addInput = addInput;
    this.label = label;
  }

  connect(
    sourceNode: AudioNode | AudioParam | MIDINode,
    outputNumOrDescriptor?: number | ConnectableDescriptor
  ) {
    if (!outputNumOrDescriptor || typeof outputNumOrDescriptor === 'number') {
      throw new Error(
        'Must provide `ConnectableDescriptor` as second argument to `connect` for `PlaceholderInput`'
      );
    }
    const txDescriptor = outputNumOrDescriptor;

    setTimeout(() => {
      // Disconnect from the dummy "add a new control", create a new input for it, and re-connect it to that
      dispatch(
        actionCreators.viewContextManager.DISCONNECT(txDescriptor, {
          vcId: this.vcId,
          name: this.label,
        })
      );

      let inputName = txDescriptor.name;
      while (
        getState()
          .viewContextManager.patchNetwork.connectables.get(this.vcId)
          ?.inputs.has(inputName)
      ) {
        inputName += '_1';
      }

      const txConnectables = getState().viewContextManager.patchNetwork.connectables.get(
        txDescriptor.vcId
      );
      if (!txConnectables) {
        throw new Error(`No connectables found for vcId=${txDescriptor.vcId}`);
      }
      const txConnectable = txConnectables.outputs.get(txDescriptor.name);
      if (!txConnectable) {
        throw new Error(
          `No output named "${txDescriptor.name}" found for vcId=${txDescriptor.vcId}`
        );
      }
      this.addInput(inputName, txConnectable.type, txDescriptor);

      updateConnectables(this.vcId, this.getConnectables());
      dispatch(
        actionCreators.viewContextManager.CONNECT(txDescriptor, {
          vcId: this.vcId,
          name: inputName,
        })
      );
    });

    return sourceNode as any;
  }
}
