import { Option } from 'funfix-core';
import { Map } from 'immutable';
import * as R from 'ramda';
import { shallowEqual } from 'react-redux';
import type { Unsubscribe } from 'redux';

import { PlaceholderOutput } from 'src/controlPanel/PlaceholderOutput';
import { PlaceholderInput } from 'src/controlPanel/PlaceholderInput';
import { OverridableAudioNode, OverridableAudioParam } from 'src/graphEditor/nodes/util';
import DefaultComposition from 'src/init-composition.json';
import type {
  AudioConnectables,
  ConnectableDescriptor,
  ConnectableInput,
  ConnectableOutput,
  PatchNetwork,
} from 'src/patchNetwork';
import type { MIDINode } from 'src/patchNetwork/midiNode';
import { reinitializeWithComposition, setCurLoadedCompositionId } from 'src/persistance';
import { getState, store } from 'src/redux';
import { filterNils, getEngine, UnreachableError } from 'src/util';
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

        const subgraphId =
          getState().viewContextManager.activeViewContexts.find(vc => vc.uuid === vcId)
            ?.subgraphId ??
          getState().viewContextManager.foreignConnectables.find(fc => fc.id === vcId)?.subgraphId;
        if (!subgraphId) {
          throw new Error(`vcId=${vcId} was not found in any view context or foreign connectable`);
        }

        return {
          id: vcId.toString(),
          type: node.nodeType,
          serializedState: node.serialize ? node.serialize() : null,
          subgraphId,
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
  srcDescriptor: ConnectableDescriptor,
  dstDescriptor: ConnectableDescriptor
) => {
  // We handle the special case of an `OverridableAudioParam` or `OverridableAudioNode` here, notifying it of its potentially new status
  if (dst instanceof OverridableAudioParam || dst instanceof OverridableAudioNode) {
    dst.setIsOverridden(false);
  }

  (src as any).connect(dst, src instanceof PlaceholderOutput ? dstDescriptor : undefined);

  if (dst instanceof PlaceholderInput) {
    dst.connect(src, srcDescriptor);
  }
};

export const disconnectNodes = (
  src: AudioNode | MIDINode,
  dst: AudioNode | MIDINode | AudioParam,
  dstDescriptor: ConnectableDescriptor
) => {
  // We handle the special case of an `OverridableAudioParam` or `OverridableAudioNode` here, notifying it of its potentially new status
  if (dst instanceof OverridableAudioParam || dst instanceof OverridableAudioNode) {
    dst.setIsOverridden(true);
  }

  try {
    (src as any).disconnect(dst, src instanceof PlaceholderOutput ? dstDescriptor : undefined);
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

let vcmUpdateQueued = false;

/**
 * Checks to see if connections and/or foreign nodes have changed between two versions of the patch network.
 * If they have, trigger the Rust VCM state to be updated with the new state.
 */
export const maybeUpdateVCM = (
  engine: typeof import('src/engine'),
  oldPatchNetwork: PatchNetwork,
  newPatchNetwork: PatchNetwork
) => {
  if (vcmUpdateQueued) {
    return;
  }

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
  vcmUpdateQueued = true;

  setTimeout(() => {
    try {
      const freshPatchNetwork = getState().viewContextManager.patchNetwork;
      const freshForeignConnectables = freshPatchNetwork.connectables.filter(({ node }) => !!node);

      if (!connectionsUnchanged) {
        engine.set_connections(JSON.stringify(freshPatchNetwork.connections));
      }

      if (!foreignConnectablesUnchanged) {
        commitForeignConnectables(engine, freshForeignConnectables);
      }
    } finally {
      vcmUpdateQueued = false;
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
  setCurLoadedCompositionId(null);
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

export interface ConnectionDescriptor {
  txVcId: string;
  rxVcId: string;
  txPortName: string;
  rxPortName: string;
  txNode: AudioNode | MIDINode;
  rxNode: AudioNode | MIDINode | AudioParam;
}

/**
 * Subscribes to changes in the connections to/from the given VC ID.
 *
 * @returns An `Unsubscribe` function that can be called to unsubscribe from the store.
 */
export const subscribeToConnections = (
  vcId: string,
  cb: (
    newConnections: { inputs: ConnectionDescriptor[]; outputs: ConnectionDescriptor[] } | undefined
  ) => void
): Unsubscribe => {
  const buildConnectionDescriptor = ([from, to]: [
    ConnectableDescriptor,
    ConnectableDescriptor,
  ]): ConnectionDescriptor | null => {
    const txNode = getState()
      .viewContextManager.patchNetwork.connectables.get(from.vcId)
      ?.outputs.get(from.name)?.node;
    if (!txNode) {
      return null;
    }
    if (txNode instanceof AudioParam) {
      throw new UnreachableError('`AudioParam`s cannot be source nodes');
    }

    const rxNode = getState()
      .viewContextManager.patchNetwork.connectables.get(to.vcId)
      ?.inputs.get(to.name)?.node;
    if (!rxNode) {
      return null;
    }

    return {
      txVcId: from.vcId,
      rxVcId: to.vcId,
      txPortName: from.name,
      rxPortName: to.name,
      txNode,
      rxNode,
    };
  };

  const getConnectionsForVc = () => {
    const conns = getState().viewContextManager.patchNetwork.connections.filter(
      ([from, to]) => from.vcId === vcId || to.vcId === vcId
    );
    return filterNils(
      R.sortWith(
        [
          R.ascend(([from, _to]) => from.vcId),
          R.ascend(([from, _to]) => from.name),
          R.ascend(([_from, to]) => to.vcId),
          R.ascend(([_from, to]) => to.name),
        ],
        conns
      ).map(buildConnectionDescriptor)
    );
  };

  const connectionsEqual = (a: ConnectionDescriptor[], b: ConnectionDescriptor[]): boolean => {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((conn, ix) => shallowEqual(conn, b[ix]));
  };

  let lastConnections: [ConnectableDescriptor, ConnectableDescriptor][] =
    getState().viewContextManager.patchNetwork.connections;
  let lastConnectables = getConnectionsForVc();

  return store.subscribe(() => {
    // Fast path if no connections have changed
    const newConnections = getState().viewContextManager.patchNetwork.connections;
    if (newConnections === lastConnections) {
      return;
    }
    lastConnections = newConnections;

    const connectables = getConnectionsForVc();

    if (!connectionsEqual(connectables, lastConnectables)) {
      const [inputs, outputs] = R.partition(conn => conn.rxVcId === vcId, connectables);

      cb({ inputs, outputs });
      lastConnectables = connectables;
    }
  });
};
