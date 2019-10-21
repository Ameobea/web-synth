import { Map, Set } from 'immutable';
import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import {
  initPatchNetwork,
  PatchNetwork,
  ConnectableDescriptor,
  AudioConnectables,
} from 'src/patchNetwork/patchNetwork';
import { getEngine } from 'src';
import { getForeignNodeType } from 'src/graphEditor/nodes/CustomAudio';

export interface VCMState {
  activeViewContexts: { name: string; uuid: string; title?: string }[];
  activeViewContextIx: number;
  patchNetwork: PatchNetwork;
}

export const getConnectedPair = (
  connectables: Map<string, AudioConnectables>,
  from: ConnectableDescriptor,
  to: ConnectableDescriptor
) => {
  const fromConnectables = connectables.get(from.vcId);
  if (!fromConnectables) {
    console.error(`No connectables found for VC ID ${from.vcId}`, connectables);
    return null;
  }
  const fromNode = fromConnectables.outputs.get(from.name);
  if (!fromNode) {
    console.error(`No output of name ${from.name} found in connectables of VC ID ${from.vcId}`);
    return null;
  }

  const toConnectables = connectables.get(to.vcId);
  if (!toConnectables) {
    console.error(`No connectables found for VC ID ${to.vcId}`, connectables);
    return null;
  }
  const toNode = toConnectables.inputs.get(to.name);
  if (!toNode) {
    console.error(`No output of name ${to.name} found in connectables of VC ID ${to.vcId}`);
    return null;
  }

  return [fromNode, toNode];
};

/**
 * Checks to see if connections and/or foreign nodes have changed between two versions of the patch network.  If they have, trigger
 * the Rust VCM state to be updated with the new state.
 */
const maybeUpdateVCM = (
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

  debugger;

  if (connectionsUnchanged && foreignConnectablesUnchanged) {
    return;
  }

  setTimeout(() => {
    if (!connectionsUnchanged) {
      engine.set_connections(JSON.stringify(newPatchNetwork.connections));
    }

    if (!foreignConnectablesUnchanged) {
      engine.set_foreign_connectables(
        JSON.stringify(
          [...newForeignConnectables.values()].map(({ vcId, node }) => ({
            id: vcId.toString(),
            type: getForeignNodeType(node!),
          }))
        )
      );
    }
  }, 0);
};

const actionGroups = {
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (
      newState: Pick<VCMState, 'activeViewContextIx' | 'activeViewContexts'> & {
        foreignConnectables: { type: string; id: string }[];
      },
      connections: VCMState['patchNetwork']['connections']
    ) => ({
      type: 'SET_VCM_STATE',
      newState,
      connections,
    }),
    subReducer: (state: VCMState, { connections, newState }) => {
      const engine = getEngine();
      if (!engine) {
        console.error('Tried to init patch betwork before engine was initialized');
        return state;
      } else if (R.isEmpty(newState.activeViewContexts)) {
        console.error(
          'Tried to init patch network with an empty list of active VCs; probably called too soon'
        );
      }

      // Trigger a side effect of updating the patch network with the new state
      const patchNetwork = initPatchNetwork(
        state.patchNetwork,
        newState.activeViewContexts,
        newState.foreignConnectables,
        connections
      );

      maybeUpdateVCM(engine, state.patchNetwork, patchNetwork);

      return { ...newState, patchNetwork };
    },
  }),
  CONNECT: buildActionGroup({
    actionCreator: (from: ConnectableDescriptor, to: ConnectableDescriptor) => ({
      type: 'CONNECT',
      from,
      to,
    }),
    subReducer: (state: VCMState, { from, to }) => {
      const { connectables, connections } = state.patchNetwork;

      // Make sure we don't have an existing connection already
      if (
        connections.find(
          ([from2, to2]) =>
            from2.name === from.name &&
            from2.vcId === from.vcId &&
            to2.name === to.name &&
            to2.vcId === to2.vcId
        )
      ) {
        console.warn(
          `A connection already exists between ${JSON.stringify(from)} and ${JSON.stringify(
            to
          )}; performing no action`
        );
        return state;
      }

      const connectedPair = getConnectedPair(connectables, from, to);
      if (!connectedPair) {
        return state;
      }
      const [fromNode, toNode] = connectedPair;

      // Perform the connection
      (fromNode as any).connect(toNode);

      const newConnections = [
        ...connections,
        [from, to] as [ConnectableDescriptor, ConnectableDescriptor],
      ];

      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to perform connection');
        return state;
      }

      const newPatchNetwork = {
        ...state.patchNetwork,
        connections: newConnections,
      };

      maybeUpdateVCM(engine, state.patchNetwork, newPatchNetwork);

      return { ...state, patchNetwork: newPatchNetwork };
    },
  }),
  DISCONNECT: buildActionGroup({
    actionCreator: (from: ConnectableDescriptor, to: ConnectableDescriptor) => ({
      type: 'DISCONNECT',
      from,
      to,
    }),
    subReducer: (state: VCMState, { from, to }) => {
      const { connectables, connections } = state.patchNetwork;

      // Make sure we have an existing connection already
      if (
        !connections.find(
          ([from2, to2]) =>
            from2.name === from.name &&
            from2.vcId === from.vcId &&
            to2.name === to.name &&
            to2.vcId === to.vcId
        )
      ) {
        console.warn(
          `A connection doesn't exist between ${JSON.stringify(from)} and ${JSON.stringify(
            to
          )}; performing no action`
        );
        return state;
      }

      const connectedPair = getConnectedPair(connectables, from, to);
      if (!connectedPair) {
        return state;
      }
      const [fromNode, toNode] = connectedPair;

      // Perform the disconnection
      (fromNode as any).disconnect(toNode);

      const newConnections = [...connections].filter(
        ([from2, to2]) =>
          from2.name !== from.name ||
          from2.vcId !== from.vcId ||
          to2.name !== to2.name ||
          to2.vcId !== to.vcId
      );

      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to perform disconnection');
        return state;
      }

      const newPatchNetwork = {
        ...state.patchNetwork,
        connections: newConnections,
      };
      maybeUpdateVCM(engine, state.patchNetwork, newPatchNetwork);

      return { ...state, patchNetwork: newPatchNetwork };
    },
  }),
  ADD_PATCH_NETWORK_NODE: buildActionGroup({
    actionCreator: (vcId: string, connectables: AudioConnectables) => ({
      type: 'ADD_PATCH_NETWORK_NODE',
      vcId,
      connectables,
    }),
    subReducer: (state: VCMState, { vcId, connectables }) => {
      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to delete node');
        return state;
      }

      const newPatchNetwork = {
        ...state.patchNetwork,
        connectables: state.patchNetwork.connectables.set(vcId, connectables),
      };
      maybeUpdateVCM(engine, state.patchNetwork, newPatchNetwork);

      return { ...state, patchNetwork: newPatchNetwork };
    },
  }),
  REMOVE_PATCH_NETWORK_NODE: buildActionGroup({
    actionCreator: (vcId: string) => ({ type: 'REMOVE_PATCH_NETWORK_NODE', vcId }),
    subReducer: (state: VCMState, { vcId }) => {
      const { connectables, connections } = state.patchNetwork;

      const targetNode = connectables.get(vcId);
      if (!targetNode) {
        console.warn(`Tried to delete connectables for VC ID ${vcId} but one wasn't found`);
        return state;
      }

      // Disconnect everything connected to the node being deleted
      const newConnections = connections.filter(([from, to]) => {
        if (from.vcId !== vcId && to.vcId !== vcId) {
          return true;
        }

        const connectedPair = getConnectedPair(state.patchNetwork.connectables, from, to);
        if (!connectedPair) {
          return false;
        }
        (connectedPair[0] as any).disconnect(connectedPair[1]);
        return false;
      });

      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to delete node');
        return state;
      }

      const newPatchNetwork = {
        connectables: connectables.remove(vcId),
        connections: newConnections,
      };
      maybeUpdateVCM(engine, state.patchNetwork, newPatchNetwork);

      return { ...state, patchNetwork: newPatchNetwork };
    },
  }),
  UPDATE_CONNECTABLES: buildActionGroup({
    actionCreator: (vcId: string, newConnectables: AudioConnectables) => ({
      type: 'UPDATE_CONNECTABLES',
      vcId,
      newConnectables,
    }),
    subReducer: (state: VCMState, { vcId, newConnectables }) => {
      const { connectables, connections } = state.patchNetwork;

      // All we have to do is disconnect any connections that are connected to inputs/outputs on the altered node that
      // no longer exist and replace the connectables object with the new one
      const oldConnectables = connectables.get(vcId);
      if (!oldConnectables) {
        return {
          ...state,
          patchNetwork: {
            ...state.patchNetwork,
            connectables: connectables.set(vcId, newConnectables),
          },
        };
      }

      // TODO: Disconnect all connections, delete connections that are no longer valid, and re-connect valid connections to
      // the new connectables rather than leaving them connected to the old one
      const deletedInputNames: Set<string> = [...oldConnectables.inputs.keys()].reduce(
        (acc, key) => (newConnectables.inputs.get(key) ? acc : acc.add(key)),
        Set()
      );
      const deletedOutputNames: Set<string> = [...oldConnectables.outputs.keys()].reduce(
        (acc, key) => (newConnectables.outputs.get(key) ? acc : acc.add(key)),
        Set()
      );

      const newConnections = connections.filter(([from, to]) => {
        if (from.vcId !== vcId && to.vcId !== vcId) {
          return true;
        } else if (deletedOutputNames.has(from.name) || deletedInputNames.has(to.name)) {
          return true;
        }

        const connectedPair = getConnectedPair(connectables, from, to);
        if (!connectedPair) {
          return false;
        }

        (connectedPair[0] as any).disconnect(connectedPair[1]);
        return false;
      });

      return {
        ...state,
        patchNetwork: {
          connectables: connectables.set(vcId, newConnectables),
          connections: newConnections,
        },
      };
    },
  }),
};

const initialState: VCMState = {
  activeViewContexts: [],
  activeViewContextIx: 0,
  patchNetwork: {
    connectables: Map(),
    connections: [],
  },
};

export default buildModule<VCMState, typeof actionGroups>(initialState, actionGroups);
