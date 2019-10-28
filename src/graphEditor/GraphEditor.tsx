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
});

const GraphEditor: React.FC<{ stateKey: string } & ReturnType<typeof mapStateToProps>> = ({
  stateKey,
  patchNetwork,
  activeViewContexts,
}) => {
  const isInitialized = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lGraphInstance, setLGraphInstance] = useState<null | any>(null);

  useEffect(() => {
    if (isInitialized.current || !canvasRef.current) {
      return;
    }
    isInitialized.current = true;

    (async () => {
      // Register custom node types
      await registerAllCustomNodes();

      const graph = new LiteGraph.LGraph();
      new LiteGraph.LGraphCanvas('#graph-editor', graph);

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

  const uiControls = useMemo(
    () => (lGraphInstance ? { arrange: () => lGraphInstance.arrange() } : {}),
    [lGraphInstance]
  );

  return (
    <div className='graph-editor-container'>
      <canvas
        ref={ref => (canvasRef.current = ref)}
        id='graph-editor'
        width={1000}
        height={800}
      ></canvas>

      <ControlPanel>
        <Button label='arrange' action={uiControls.arrange} />
      </ControlPanel>
    </div>
  );
};

export default connect(mapStateToProps)(GraphEditor);
