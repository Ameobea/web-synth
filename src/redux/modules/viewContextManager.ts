import { Option } from 'funfix-core';
import { Map, Set } from 'immutable';
import { buildActionGroup, buildModule } from 'jantix';
import * as R from 'ramda';

import type {
  AudioConnectables,
  ConnectableDescriptor,
  ForeignConnectable,
  PatchNetwork,
  SubgraphDescriptor,
} from 'src/patchNetwork/patchNetwork';
import {
  connectNodes,
  disconnectNodes,
  getConnectedPair,
  maybeUpdateVCM,
} from 'src/redux/modules/vcmUtils';
import { getEngine } from 'src/util';

export interface VCMState {
  activeViewContexts: { name: string; uuid: string; title?: string; subgraphId: string }[];
  foreignConnectables: ForeignConnectable[];
  activeViewContextId: string;
  activeSubgraphID: string;
  patchNetwork: PatchNetwork;
  /**
   * If true, this indicates that the patch network has been populated from any persisted state
   */
  isLoaded: boolean;
  subgraphsByID: { [subgraphID: string]: SubgraphDescriptor };
}

const actionGroups = {
  SET_IS_LOADED: buildActionGroup({
    actionCreator: (isLoaded: boolean) => ({ type: 'SET_IS_LOADED', isLoaded }),
    subReducer: (state: VCMState, { isLoaded }) => ({ ...state, isLoaded }),
  }),
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (
      newState: Pick<
        VCMState,
        'activeViewContextId' | 'activeViewContexts' | 'subgraphsByID' | 'foreignConnectables'
      >,
      getPatchNetworkReturnVal: PatchNetwork,
      activeSubgraphID: string
    ) => ({
      type: 'SET_VCM_STATE',
      newState,
      patchNetwork: getPatchNetworkReturnVal,
      activeSubgraphID,
    }),
    subReducer: (
      state: VCMState,
      { patchNetwork: newPatchNetwork, newState, activeSubgraphID }
    ) => {
      const engine = getEngine();
      if (!engine) {
        console.error('Tried to init patch betwork before engine was initialized');
        return state;
      } else if (R.isEmpty(newState.activeViewContexts)) {
        console.error(
          'Tried to init patch network with an empty list of active VCs; probably called too soon'
        );
      }

      maybeUpdateVCM(engine, state.patchNetwork, newPatchNetwork);

      return { ...newState, patchNetwork: newPatchNetwork, isLoaded: true, activeSubgraphID };
    },
  }),
  SET_CONNECTIONS: buildActionGroup({
    actionCreator: (connections: [ConnectableDescriptor, ConnectableDescriptor][]) => ({
      type: 'SET_CONNECTIONS',
      connections,
    }),
    subReducer: (state: VCMState, { connections }) => {
      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to set connections');
        return state;
      }

      const newPatchNetwork = {
        ...state.patchNetwork,
        connections,
      };
      maybeUpdateVCM(engine, state.patchNetwork, newPatchNetwork);

      return { ...state, patchNetwork: newPatchNetwork };
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
            to2.vcId === to.vcId
        )
      ) {
        return state;
      }

      const connectedPair = getConnectedPair(connectables, from, to);
      if (!connectedPair) {
        return state;
      }
      const [fromConnectable, toConnectable] = connectedPair;

      if (
        fromConnectable.type !== toConnectable.type &&
        fromConnectable.type !== 'any' &&
        toConnectable.type !== 'any'
      ) {
        console.warn(
          'Tried to connect two connectables of different types: ',
          fromConnectable,
          toConnectable
        );
        return state;
      }

      connectNodes(fromConnectable.node, toConnectable.node, from, to);

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
        // console.warn(
        //   `A connection doesn't exist between ${JSON.stringify(from)} and ${JSON.stringify(
        //     to
        //   )}; performing no action`
        // );
        return state;
      }

      const connectedPair = getConnectedPair(connectables, from, to);
      if (!connectedPair) {
        return state;
      }
      const [fromConnectable, toConnectable] = connectedPair;

      disconnectNodes(fromConnectable.node, toConnectable.node, to);

      const newConnections: [ConnectableDescriptor, ConnectableDescriptor][] = [
        ...connections,
      ].filter(
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
  SET_FOREIGN_CONNECTABLES: buildActionGroup({
    actionCreator: (foreignConnectables: ForeignConnectable[]) => ({
      type: 'SET_FOREIGN_CONNECTABLES',
      foreignConnectables,
    }),
    subReducer: (state: VCMState, { foreignConnectables }) => ({ ...state, foreignConnectables }),
  }),
  SET_VIEW_CONTEXTS: buildActionGroup({
    actionCreator: (
      activeViewContextId: string,
      activeViewContexts: { name: string; uuid: string; title?: string; subgraphId: string }[]
    ) => ({
      type: 'SET_VIEW_CONTEXTS',
      activeViewContextId,
      activeViewContexts,
    }),
    subReducer: (state: VCMState, { activeViewContextId, activeViewContexts }) => ({
      ...state,
      activeViewContexts,
      activeViewContextId,
    }),
  }),
  ADD_PATCH_NETWORK_NODE: buildActionGroup({
    actionCreator: (vcId: string, connectables: AudioConnectables | null, subgraphId: string) => ({
      type: 'ADD_PATCH_NETWORK_NODE',
      vcId,
      connectables,
      subgraphId,
    }),
    subReducer: (state: VCMState, { vcId, connectables, subgraphId }) => {
      if (!connectables || state.patchNetwork.connectables.has(vcId)) {
        return state;
      }

      const engine = getEngine();
      if (!engine) {
        console.error('Engine handle was not set when trying to add patch network node');
        return state;
      }

      const newPatchNetwork = {
        ...state.patchNetwork,
        connectables: state.patchNetwork.connectables.set(vcId, connectables),
      };
      maybeUpdateVCM(engine, state.patchNetwork, newPatchNetwork);

      return {
        ...state,
        patchNetwork: newPatchNetwork,
        foreignConnectables: connectables.node
          ? [
              ...state.foreignConnectables,
              {
                type: connectables.node.nodeType,
                id: vcId,
                subgraphId,
                serializedState: connectables.node.serialize ? connectables.node.serialize() : null,
              },
            ]
          : state.foreignConnectables,
      };
    },
  }),
  REMOVE_PATCH_NETWORK_NODE: buildActionGroup({
    actionCreator: (vcId: string) => ({ type: 'REMOVE_PATCH_NETWORK_NODE', vcId }),
    subReducer: (state: VCMState, { vcId }) => {
      const { connectables, connections } = state.patchNetwork;

      const targetNode = connectables.get(vcId);
      if (!targetNode) {
        // console.warn(`Tried to delete connectables for VC ID ${vcId} but one wasn't found`);
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

        disconnectNodes(connectedPair[0].node, connectedPair[1].node, to);

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

      return {
        ...state,
        patchNetwork: newPatchNetwork,
        foreignConnectables: state.foreignConnectables.filter(fc => fc.id !== vcId),
      };
    },
  }),
  UPDATE_CONNECTABLES: buildActionGroup({
    actionCreator: (vcId: string, newConnectables: AudioConnectables) => ({
      type: 'UPDATE_CONNECTABLES',
      vcId,
      newConnectables,
    }),
    subReducer: (state: VCMState, { vcId, newConnectables: newConnectablesForNode }) => {
      const { connectables, connections } = state.patchNetwork;

      // All we have to do is disconnect any connections that are connected to inputs/outputs on the altered node that
      // no longer exist and replace the connectables object with the new one
      const oldConnectables = connectables.get(vcId);
      if (!oldConnectables) {
        console.warn(`Tried to update connectables for VC ID ${vcId} but old ones weren't found`);
        return {
          ...state,
          patchNetwork: {
            ...state.patchNetwork,
            connectables: connectables.set(vcId, newConnectablesForNode),
          },
        };
      }
      const newConnectables = connectables.set(vcId, newConnectablesForNode);

      // Inputs and outputs that aren't present on the new connectables must be disconnected and deleted completely
      const deletedInputNames: Set<string> = [...oldConnectables.inputs.keys()].reduce(
        (acc, key) => (newConnectablesForNode.inputs.get(key) ? acc : acc.add(key)),
        Set<string>()
      );
      const deletedOutputNames: Set<string> = [...oldConnectables.outputs.keys()].reduce(
        (acc, key) => (newConnectablesForNode.outputs.get(key) ? acc : acc.add(key)),
        Set<string>()
      );

      const newConnections = connections.filter(([from, to]) => {
        if (from.vcId !== vcId && to.vcId !== vcId) {
          return true;
        }

        // If an underlying input or output has been deleted, the connection must be deleted as well.
        if (deletedOutputNames.has(from.name) || deletedInputNames.has(to.name)) {
          const connectedPair = getConnectedPair(connectables, from, to);
          if (!connectedPair) {
            return false;
          }

          disconnectNodes(connectedPair[0].node, connectedPair[1].node, to);
          return false;
        }

        // Inputs and outputs that exist on both the old connectables and the new ones must be checked.  If the underlying node or param
        // is referrentially equal, we can keep it connected.  Otherwise, we must delete it and re-create.
        const needsReconnect = (() => {
          const weAreOutput = from.vcId === vcId;

          if (weAreOutput) {
            const oldOutputConnectable = oldConnectables.outputs.get(from.name);
            return (
              oldOutputConnectable &&
              oldOutputConnectable.node !==
                Option.of(newConnectablesForNode.outputs.get(from.name))
                  .map(R.prop('node'))
                  .orNull()
            );
          } else {
            const oldInputConnectable = oldConnectables.inputs.get(to.name);
            return (
              oldInputConnectable &&
              oldInputConnectable.node !==
                Option.of(newConnectablesForNode.inputs.get(to.name)).map(R.prop('node')).orNull()
            );
          }
        })();

        if (needsReconnect) {
          const oldConnectedPair = getConnectedPair(connectables, from, to);
          if (!oldConnectedPair) {
            console.error(
              "Tried to get connected pair to disconnect from old connectables but it wasn't found: ",
              connectables,
              from,
              to
            );
            return;
          }

          disconnectNodes(oldConnectedPair[0].node, oldConnectedPair[1].node, to);

          const newConnectedPair = getConnectedPair(newConnectables, from, to);
          if (!newConnectedPair) {
            console.error(
              "Tried to get connected pair to re-connect to new connectables but it wasn't found: ",
              newConnectables,
              from,
              to
            );
            return;
          }

          connectNodes(newConnectedPair[0].node, newConnectedPair[1].node, from, to);
        }

        return true;
      });

      const newPatchNetwork = {
        connectables: newConnectables,
        connections: newConnections,
      };
      maybeUpdateVCM(getEngine()!, state.patchNetwork, newPatchNetwork);

      return { ...state, patchNetwork: newPatchNetwork };
    },
  }),
  ADD_VIEW_CONTEXT: buildActionGroup({
    actionCreator: (uuid: string, name: string, subgraphID: string) => ({
      type: 'ADD_VIEW_CONTEXT',
      uuid,
      name,
      subgraphID,
    }),
    subReducer: (state: VCMState, { uuid, name, subgraphID }) => ({
      ...state,
      activeViewContexts: [...state.activeViewContexts, { uuid, name, subgraphId: subgraphID }],
    }),
  }),
  ADD_FOREIGN_CONNECTABLE: buildActionGroup({
    actionCreator: (id: string, fc: ForeignConnectable) => ({
      type: 'ADD_FOREIGN_CONNECTABLE',
      id,
      fc,
    }),
    subReducer: (state: VCMState, { id, fc }) => {
      if (state.foreignConnectables.some(f => f.id === id)) {
        throw new Error(`Tried to add foreign connectable with ID ${id} but one already exists`);
      }

      return {
        ...state,
        foreignConnectables: [...state.foreignConnectables, { ...fc, id }],
      };
    },
  }),
  DELETE_VIEW_CONTEXT: buildActionGroup({
    actionCreator: (uuid: string) => ({ type: 'DELETE_VIEW_CONTEXT', uuid }),
    subReducer: (state: VCMState, { uuid }) => ({
      ...state,
      activeViewContexts: state.activeViewContexts.filter(entry => entry.uuid !== uuid),
    }),
  }),
  SET_ACTIVE_VC_ID: buildActionGroup({
    actionCreator: (newActiveVcId: string) => ({ type: 'SET_ACTIVE_VC_ID', newActiveVcId }),
    subReducer: (state: VCMState, { newActiveVcId }) => ({
      ...state,
      activeViewContextId: newActiveVcId,
    }),
  }),
  SET_SUBGRAPHS: buildActionGroup({
    actionCreator: (
      activeSubgraphID: string,
      subgraphsByID: { [subgraphID: string]: SubgraphDescriptor }
    ) => ({
      type: 'SET_SUBGRAPHS',
      activeSubgraphID,
      subgraphsByID,
    }),
    subReducer: (state: VCMState, { activeSubgraphID, subgraphsByID }) => ({
      ...state,
      activeSubgraphID,
      subgraphsByID,
    }),
  }),
  SET_VC_TITLE: buildActionGroup({
    actionCreator: (uuid: string, title: string) => ({ type: 'SET_VC_TITLE', uuid, title }),
    subReducer: (state: VCMState, { uuid, title }) => ({
      ...state,
      activeViewContexts: state.activeViewContexts.map(entry =>
        entry.uuid === uuid ? { ...entry, title } : entry
      ),
    }),
  }),
};

const initialState: VCMState = {
  activeViewContexts: [],
  foreignConnectables: [],
  activeViewContextId: '',
  activeSubgraphID: '',
  patchNetwork: {
    connectables: Map(),
    connections: [],
  },
  isLoaded: false,
  subgraphsByID: {},
};

export default buildModule<VCMState, typeof actionGroups>(initialState, actionGroups);
