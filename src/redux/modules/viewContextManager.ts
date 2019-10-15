import { Map, Set } from 'immutable';
import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';

import {
  initPatchNetwork,
  PatchNetwork,
  ConnectableDescriptor,
  AudioConnectables,
} from 'src/patchNetwork/patchNetwork';
import { getEngine } from 'src';

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
    console.error(`No connectables found for VC ID ${from.vcId}`);
    return null;
  }
  const fromNode = fromConnectables.outputs.get(from.name);
  if (!fromNode) {
    console.error(`No output of name ${from.name} found in connectables of VC ID ${from.vcId}`);
    return null;
  }

  const toConnectables = connectables.get(to.vcId);
  if (!toConnectables) {
    console.error(`No connectables found for VC ID ${to.vcId}`);
    return null;
  }
  const toNode = toConnectables.outputs.get(to.name);
  if (!toNode) {
    console.error(`No output of name ${to.name} found in connectables of VC ID ${to.vcId}`);
    return null;
  }

  return [fromNode, toNode];
};

const actionGroups = {
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (
      newState: Pick<VCMState, 'activeViewContextIx' | 'activeViewContexts'>,
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
        connections
      );

      setTimeout(() => engine.set_connections(JSON.stringify(patchNetwork.connections)), 0);

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
      fromNode.connect(toNode);

      const newConnections = [
        ...connections,
        [from, to] as [ConnectableDescriptor, ConnectableDescriptor],
      ];

      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to perform connection');
      } else {
        setTimeout(() => engine.set_connections(JSON.stringify(newConnections)), 0);
      }

      // Add a connection to the list of connections
      return {
        ...state,
        patchNetwork: {
          ...state.patchNetwork,
          connections: newConnections,
        },
      };
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
      fromNode.disconnect(toNode);

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
      } else {
        setTimeout(() => engine.set_connections(JSON.stringify(newConnections)), 0);
      }

      // Remove the connection from the list of connections
      return {
        ...state,
        patchNetwork: {
          ...state.patchNetwork,
          connections: newConnections,
        },
      };
    },
  }),
  ADD_PATCH_NETWORK_NODE: buildActionGroup({
    actionCreator: (vcId: string, connectables: AudioConnectables) => ({
      type: 'ADD_PATCH_NETWORK_NODE',
      vcId,
      connectables,
    }),
    subReducer: (state: VCMState, { vcId, connectables }) => ({
      ...state,
      patchNetwork: {
        ...state.patchNetwork,
        connectables: state.patchNetwork.connectables.set(vcId, connectables),
      },
    }),
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
        connectedPair[0].disconnect(connectedPair[1]);
        return false;
      });

      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to delete node');
      } else {
        setTimeout(() => engine.set_connections(JSON.stringify(newConnections)), 0);
      }

      return {
        ...state,
        patchNetwork: {
          connectables: connectables.remove(vcId),
          connections: newConnections,
        },
      };
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

        connectedPair[0].disconnect(connectedPair[1]);
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
