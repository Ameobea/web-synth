import { Option } from 'funfix-core';
import { Map } from 'immutable';
import * as R from 'ramda';

import { PlaceholderInput } from 'src/controlPanel/PlaceholderInput';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import DefaultComposition from 'src/init-composition.json';
import type {
  AudioConnectables,
  ConnectableDescriptor,
  ConnectableInput,
  ConnectableOutput,
  PatchNetwork,
} from 'src/patchNetwork';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import { reinitializeWithComposition } from 'src/persistance';
import { getState } from 'src/redux';
import { getEngine } from 'src/util';
import { setGlobalVolume } from 'src/ViewContextManager/GlobalVolumeSlider';

/**
 * Commits the state of the provided `patchNetwork`'s foreign connectables to the Rust/Wasm engine,
 * triggering their state to be serialized and saved to `localStorage` in the process.
 */
export const commitForeignConnectables = (
  engine: typeof import('src/engine'),
  foreignConnectables: Map<string, AudioConnectables>
) =>
  engine.set_foreign_connectables(
    JSON.stringify(
      [...foreignConnectables.values()].map(({ vcId, node }) => {
        if (!node) {
          throw new Error("Foreign connectables didn't have a `node`");
        } else if (Number.isNaN(+vcId)) {
          throw new Error(`Foreign connectable with non-numeric \`vcId\` found: "${vcId}"`);
        }

        return {
          id: vcId.toString(),
          type: node.nodeType,
          serializedState: node.serialize ? node.serialize() : null,
        };
      })
    )
  );

/**
 * Helper function to handle connecting two nodes of various types together.
 */
export const connectNodes = (
  src: AudioNode | MIDINode,
  dst: AudioNode | MIDINode | AudioParam,
  dstDescriptor: ConnectableDescriptor
) => {
  // We handle the special case of an `OverridableAudioParam` here, notifying it of its potentially new status
  if (dst instanceof OverridableAudioParam) {
    dst.setIsOverridden(false);
  }

  (src as any).connect(dst, src instanceof PlaceholderInput ? dstDescriptor : undefined);
};

export const disconnectNodes = (
  src: AudioNode | MIDINode,
  dst: AudioNode | MIDINode | AudioParam,
  dstDescriptor: ConnectableDescriptor
) => {
  // We handle the special case of an `OverridableAudioParam` here, notifying it of its potentially new status
  if (dst instanceof OverridableAudioParam) {
    dst.setIsOverridden(true);
  }

  try {
    (src as any).disconnect(dst, src instanceof PlaceholderInput ? dstDescriptor : undefined);
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.message.includes('is not connected to the given destination')
    ) {
      console.warn("Tried to disconnect two nodes that aren't connected; ", {
        src,
        dst,
        dstDescriptor,
      });
    } else {
      console.error('Some error occurred while disconnecting nodes: ', {
        err,
        src,
        dst,
        dstDescriptor,
      });
    }
  }
};

/**
 * Checks to see if connections and/or foreign nodes have changed between two versions of the patch network.
 * If they have, trigger the Rust VCM state to be updated with the new state.
 */
export const maybeUpdateVCM = (
  engine: typeof import('src/engine'),
  oldPatchNetwork: PatchNetwork,
  newPatchNetwork: PatchNetwork
) => {
  const connectionsUnchanged =
    oldPatchNetwork.connections.length === newPatchNetwork.connections.length &&
    oldPatchNetwork.connections.every(conn =>
      newPatchNetwork.connections.find(conn2 => R.equals(conn, conn2))
    );

  const oldForeignConnectables = oldPatchNetwork.connectables.filter(({ node }) => !!node);
  const newForeignConnectables = newPatchNetwork.connectables.filter(({ node }) => !!node);
  const foreignConnectablesUnchanged =
    oldForeignConnectables.size === newForeignConnectables.size &&
    oldForeignConnectables.every((connectables, key) =>
      Option.of(newForeignConnectables.get(key))
        .map(otherConnectables => R.equals(connectables, otherConnectables))
        .getOrElse(false)
    );

  if (connectionsUnchanged && foreignConnectablesUnchanged) {
    return;
  }

  setTimeout(() => {
    const freshPatchNetwork = getState().viewContextManager.patchNetwork;
    const freshForeignConnectables = freshPatchNetwork.connectables.filter(({ node }) => !!node);

    if (!connectionsUnchanged) {
      engine.set_connections(JSON.stringify(freshPatchNetwork.connections));
    }

    if (!foreignConnectablesUnchanged) {
      commitForeignConnectables(engine, freshForeignConnectables);
    }
  });
};

export const getConnectedPair = (
  connectables: Map<string, AudioConnectables | null>,
  from: ConnectableDescriptor,
  to: ConnectableDescriptor
): [ConnectableOutput, ConnectableInput] | null => {
  const fromConnectables = connectables.get(from.vcId);
  if (!fromConnectables) {
    console.error(`No connectables found for VC ID ${from.vcId}`, connectables);
    return null;
  }
  const fromNode = fromConnectables.outputs.get(from.name);
  if (!fromNode) {
    console.error(
      `No output of name ${from.name} found in output connectables of VC ID ${from.vcId}`
    );
    return null;
  }

  const toConnectables = connectables.get(to.vcId);
  if (!toConnectables) {
    console.error(`No connectables found for VC ID ${to.vcId}`, connectables);
    return null;
  }
  const toNode = toConnectables.inputs.get(to.name);
  if (!toNode) {
    console.error(
      `No input of name ${to.name} found in input connectables of VC ID ${
        to.vcId
      }; found: ${toConnectables.inputs.keySeq().join(', ')}`
    );
    return null;
  }

  return [fromNode, toNode];
};

export const create_empty_audio_connectables = (vcId: string): AudioConnectables => ({
  vcId,
  inputs: Map(),
  outputs: Map(),
});

export const initializeDefaultVCMState = () => {
  const engine = getEngine()!;
  const allViewContextIds = getState().viewContextManager.activeViewContexts.map(R.prop('uuid'));
  const res = reinitializeWithComposition(
    { type: 'parsed', value: DefaultComposition },
    engine,
    allViewContextIds
  );
  if (res.value) {
    alert('Error loading composition: ' + res.value);
  }
  setGlobalVolume(20);
};
