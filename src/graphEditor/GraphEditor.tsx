/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LiteGraph } from 'litegraph.js';
import 'litegraph.js/css/litegraph.css';
import ControlPanel, { Button } from 'react-control-panel';

import { registerAllCustomNodes } from './nodes';
import './GraphEditor.scss';
import { getState, ReduxStore } from 'src/redux';
import { connect } from 'react-redux';
import { updateGraph } from 'src/graphEditor/graphDiffing';
import { tryParseJson } from 'src/util';
import { LGAudioConnectables } from 'src/graphEditor/nodes/AudioConnectablesNode';
import { getEngine } from 'src';
import FlatButton from 'src/misc/FlatButton';

(window as any).LGraph = LiteGraph.LGraph;

/**
 * Mapping of `stateKey`s to the graph instances that that they manage
 */
const instaceMap: { [stateKey: string]: any } = {};

export const saveStateForInstance = (stateKey: string) => {
  const instance = instaceMap[stateKey];
  if (!instance) {
    console.error(`No entry in \`instanceCbs\` for instance with stateKey "${stateKey}"`);
    return;
  }

  const state = instance.serialize();
  localStorage.setItem(stateKey, JSON.stringify(state));

  delete instaceMap[stateKey];
};

const mapStateToProps = (state: ReduxStore) => ({
  patchNetwork: state.viewContextManager.patchNetwork,
  activeViewContexts: state.viewContextManager.activeViewContexts,
  isLoaded: state.viewContextManager.isLoaded,
});

const handleNodeSelectAction = ({
  smallViewDOMId,
  lgNode,
  setSelectedNodeVCID,
  isNowSelected,
}: {
  smallViewDOMId: string;
  lgNode: any;
  setSelectedNodeVCID: (id: string | null) => void;
  isNowSelected: boolean;
}) => {
  const nodeID: string = (lgNode as any).id.toString();
  if (lgNode instanceof LGAudioConnectables) {
    const node = getState().viewContextManager.activeViewContexts.find(vc => vc.uuid === nodeID);
    if (!node) {
      return;
    }

    (isNowSelected ? getEngine()!.render_small_view : getEngine()!.cleanup_small_view)(
      nodeID,
      smallViewDOMId
    );
    setSelectedNodeVCID(nodeID);
  } else if (lgNode.type.startsWith('customAudio')) {
    const node = getState().viewContextManager.patchNetwork.connectables.find(
      connectable => connectable.vcId === nodeID
    );
    if (node) {
      const functionKey = isNowSelected ? 'renderSmallView' : 'cleanupSmallView';
      if (!lgNode.connectables.node[functionKey]) {
        return;
      }

      lgNode.connectables.node[functionKey](smallViewDOMId);
    }

    setSelectedNodeVCID(null);
  }
};

const GraphEditor: React.FC<{ stateKey: string } & ReturnType<typeof mapStateToProps>> = ({
  stateKey,
  patchNetwork,
  activeViewContexts,
  isLoaded,
}) => {
  const isInitialized = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lGraphInstance, setLGraphInstance] = useState<null | any>(null);
  const [selectedNodeVCID, setSelectedNodeVCID] = useState<string | null>(null);
  const curSelectedNode = useRef<any>(null);

  const smallViewDOMId = `small-view-dom-id_${stateKey}`;

  useEffect(() => {
    if (isInitialized.current || !canvasRef.current) {
      return;
    }
    isInitialized.current = true;

    (async () => {
      // Register custom node types
      await registerAllCustomNodes();

      const graph = new LiteGraph.LGraph();
      Object.keys((LiteGraph as any).registered_node_types)
        .filter(
          nodeType =>
            !nodeType.startsWith('customAudio') &&
            !nodeType.includes('faust') &&
            !nodeType.includes('audioConnectables')
        )
        .forEach(nodeType => (LiteGraph as any).unregisterNodeType(nodeType));
      const canvas = new LiteGraph.LGraphCanvas('#graph-editor', graph);

      canvas.onNodeSelected = node => {
        if (curSelectedNode.current) {
          handleNodeSelectAction({
            smallViewDOMId,
            lgNode: curSelectedNode.current,
            setSelectedNodeVCID,
            isNowSelected: false,
          });
        }
        handleNodeSelectAction({
          smallViewDOMId,
          lgNode: node,
          setSelectedNodeVCID,
          isNowSelected: true,
        });
        curSelectedNode.current = node;
      };

      graph.start();

      setLGraphInstance(graph);

      // Set an entry into the mapping so that we can get the current instance's state before unmounting
      instaceMap[stateKey] = graph;
    })();
  });

  const lastPatchNetwork = useRef<typeof patchNetwork | null>(null);
  useEffect(() => {
    if (lastPatchNetwork.current === patchNetwork || !lGraphInstance) {
      return;
    }

    updateGraph(lGraphInstance, patchNetwork, activeViewContexts);
    lastPatchNetwork.current = patchNetwork;
  }, [patchNetwork, lGraphInstance, activeViewContexts]);

  // Set node from serialized state when we first render
  useEffect(() => {
    if (!lGraphInstance || !isLoaded) {
      return;
    }
    const state =
      localStorage[stateKey] && localStorage[stateKey].length > 0
        ? tryParseJson<{ nodes: { id: string | number; pos: [number, number] }[] }, null>(
            localStorage[stateKey],
            null,
            'Error parsing serialized LiteGraph state'
          )
        : null;
    if (!state) {
      return;
    }

    state.nodes.forEach(({ id, pos }) => {
      const node = lGraphInstance._nodes_by_id[id];
      if (!node) {
        return;
      }

      node.pos = pos;
    });
    lGraphInstance.setDirtyCanvas(true, true);
  }, [stateKey, lGraphInstance, isLoaded]);

  const uiControls = useMemo(
    () => (lGraphInstance ? { arrange: () => lGraphInstance.arrange() } : {}),
    [lGraphInstance]
  );

  return (
    <div className='graph-editor-container'>
      <canvas
        ref={ref => (canvasRef.current = ref)}
        id='graph-editor'
        width={window.innerWidth - 600}
        height={800}
      />

      <div style={{ display: 'flex', width: 400, flex: 1, flexDirection: 'column' }}>
        <ControlPanel style={{ height: 120, width: 500 }}>
          <Button label='arrange' action={uiControls.arrange} />
        </ControlPanel>

        {selectedNodeVCID ? (
          <FlatButton onClick={() => getEngine()!.switch_view_context(selectedNodeVCID)}>
            Show Full UI
          </FlatButton>
        ) : null}
        <div
          style={{ display: 'flex', flex: 1, height: '100%', backgroundColor: '#111', width: 500 }}
          id={smallViewDOMId}
        />
      </div>
    </div>
  );
};

export default connect(mapStateToProps)(GraphEditor);
