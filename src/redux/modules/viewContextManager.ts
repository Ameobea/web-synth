import { buildActionGroup, buildModule } from 'jantix';

import {
  initPatchNetwork,
  PatchNetwork,
  ConnectableDescriptor,
  AudioConnectables,
} from 'src/patchNetwork/patchNetwork';

export interface VCMState {
  activeViewContexts: { name: string; uuid: string; title?: string }[];
  activeViewContextIx: number;
  patchNetwork: PatchNetwork;
}

const actionGroups = {
  SET_VCM_STATE: buildActionGroup({
    actionCreator: (newState: Pick<VCMState, 'activeViewContextIx' | 'activeViewContexts'>) => ({
      type: 'SET_VCM_STATE',
      newState,
    }),
    subReducer: (state: VCMState, { newState }) => {
      // Trigger a side effect of updating the patch network with the new state
      const newPatchNetwork = initPatchNetwork(state.patchNetwork, newState.activeViewContexts);

      return { ...newState, patchNetwork: newPatchNetwork };
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

      // TODO: Dedup code
      const fromConnectables = connectables.get(from.vcId);
      if (!fromConnectables) {
        console.error(`No connectables found for VC ID ${from.vcId}`);
        return state;
      }
      const fromNode = fromConnectables.outputs.get(from.name);
      if (!fromNode) {
        console.error(`No output of name ${from.name} found in connectables of VC ID ${from.vcId}`);
        return state;
      }

      const toConnectables = connectables.get(to.vcId);
      if (!toConnectables) {
        console.error(`No connectables found for VC ID ${to.vcId}`);
        return state;
      }
      const toNode = toConnectables.outputs.get(to.name);
      if (!toNode) {
        console.error(`No output of name ${to.name} found in connectables of VC ID ${to.vcId}`);
        return state;
      }

      // Perform the connection
      fromNode.connect(toNode);

      // Add a connection to the list of connections
      return {
        ...state,
        patchNetwork: {
          ...state.patchNetwork,
          connections: [
            ...connections,
            [from, to] as [ConnectableDescriptor, ConnectableDescriptor],
          ],
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

      // TODO: Dedup code
      const fromConnectables = connectables.get(from.vcId);
      if (!fromConnectables) {
        console.error(`No connectables found for VC ID ${from.vcId}`);
        return state;
      }
      const fromNode = fromConnectables.outputs.get(from.name);
      if (!fromNode) {
        console.error(`No output of name ${from.name} found in connectables of VC ID ${from.vcId}`);
        return state;
      }

      const toConnectables = connectables.get(to.vcId);
      if (!toConnectables) {
        console.error(`No connectables found for VC ID ${to.vcId}`);
        return state;
      }
      const toNode = toConnectables.outputs.get(to.name);
      if (!toNode) {
        console.error(`No output of name ${to.name} found in connectables of VC ID ${to.vcId}`);
        return state;
      }

      // Perform the disconnection
      fromNode.disconnect(toNode);

      // Remove the connection from the list of connections
      return {
        ...state,
        patchNetwork: {
          ...state.patchNetwork,
          connections: [...connections].filter(
            ([from2, to2]) =>
              from2.name !== from.name ||
              from2.vcId !== from.vcId ||
              to2.name !== to2.name ||
              to2.vcId !== to.vcId
          ),
        },
      };
    },
  }),
  ADD_PATCH_NETWORK_NODE: buildActionGroup({
    actionCreator: (vcId: string, connectables: AudioConnectables, vcName: string) => ({
      type: 'ADD_PATCH_NETWORK_NODE',
      vcId,
      connectables,
      vcName,
    }),
    subReducer: (state: VCMState, { vcId, connectables, vcName }) => {
      // TODO
      return state;
    },
  }),
  REMOVE_PATCH_NETWORK_NODE: buildActionGroup({
    actionCreator: (vcId: string) => ({ type: 'REMOVE_PATCH_NETWORK_NODE', vcId }),
    subReducer: (state: VCMState, { vcId }) => {
      // TODO
      return state;
    },
  }),
  UPDATE_CONNECTABLES: buildActionGroup({
    actionCreator: (vcId: string, newConnectables: AudioConnectables) => ({
      type: 'UPDATE_CONNECTABLES',
      vcId,
      newConnectables,
    }),
    subReducer: (state: VCMState, { vcId, newConnectables }) => {
      // TODO
      return state;
    },
  }),
};

const initialState: VCMState = {
  activeViewContexts: [],
  activeViewContextIx: 0,
  patchNetwork: {
    connectables: new Map(),
    connections: [],
  },
};

export default buildModule<VCMState, typeof actionGroups>(initialState, actionGroups);
