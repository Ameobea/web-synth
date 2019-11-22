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
import { ReduxStore } from 'src/redux';
import { connect } from 'react-redux';
import { updateGraph } from 'src/graphEditor/graphDiffing';
import { tryParseJson } from 'src/util';
import { LGAudioConnectables } from 'src/graphEditor/nodes/AudioConnectablesNode';
import { getEngine } from 'src';

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

const handleNodeSelectAction = (smallViewDOMId: string, lgNode: any, isNowSelected: boolean) => {
  if (lgNode instanceof LGAudioConnectables) {
    (isNowSelected ? getEngine()!.render_small_view : getEngine()!.cleanup_small_view)(
      (lgNode as any).id,
      smallViewDOMId
    );
  } else if (lgNode.type.startsWith('customAudio')) {
    const functionKey = isNowSelected ? 'renderSmallView' : 'cleanupSmallView';
    if (!lgNode.connectables.node[functionKey]) {
      return;
    }
    lgNode.connectables.node[functionKey](smallViewDOMId);
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
      const canvas = new LiteGraph.LGraphCanvas('#graph-editor', graph);

      canvas.onNodeSelected = node => {
        if (curSelectedNode.current) {
          handleNodeSelectAction(smallViewDOMId, curSelectedNode.current, false);
        }
        handleNodeSelectAction(smallViewDOMId, node, true);
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
    const state = tryParseJson<{ nodes: { id: string | number; pos: [number, number] }[] }, null>(
      localStorage[stateKey],
      null,
      'Error parsing serialized LiteGraph state'
    );
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
      ></canvas>

      <div style={{ display: 'flex', width: 400, flex: 1, flexDirection: 'column' }}>
        <ControlPanel style={{ height: 120, width: 500 }}>
          <Button label='arrange' action={uiControls.arrange} />
        </ControlPanel>

        <div
          style={{ display: 'flex', flex: 1, height: '100%', backgroundColor: '#111', width: 500 }}
          id={smallViewDOMId}
        />
      </div>
    </div>
  );
};

export default connect(mapStateToProps)(GraphEditor);
