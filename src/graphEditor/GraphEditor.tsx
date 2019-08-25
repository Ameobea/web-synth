/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { LiteGraph } from 'litegraph.js';

(window as any).LGraph = LiteGraph.LGraph;

/**
 * Mapping of `stateKey`s to functions that return the current state of that instance
 */
const instanceCbs: { [stateKey: string]: () => object } = {};

export const saveStateForInstance = (stateKey: string) => {
  const getInstanceState = instanceCbs[stateKey];
  if (!getInstanceState) {
    console.error(`No entry in \`instanceCbs\` for instance with stateKey "${stateKey}"`);
    return;
  }

  const state = getInstanceState();
  localStorage.setItem(stateKey, JSON.stringify(state));

  delete instanceCbs[stateKey];
};

const GraphEditor: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const isInitialized = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [lGraphInstance, setLGraphInstance] = useState<null | any>(null);

  useEffect(() => {
    if (isInitialized.current || !canvasRef.current) {
      return;
    }
    isInitialized.current = true;

    const graph = new LiteGraph.LGraph();
    new LiteGraph.LGraphCanvas('#graph-editor', graph);

    const existingStateJson = localStorage.getItem(stateKey);
    if (existingStateJson) {
      const configureError = graph.configure(JSON.parse(existingStateJson));
      if (configureError) {
        console.error('Error while `.configure()`ing graph with stored JSON state');
      }
    } else {
      const node_const = LiteGraph.createNode('basic/const');
      node_const.pos = [200, 200];
      graph.add(node_const);
      node_const.setValue(4.5);

      const node_watch = LiteGraph.createNode('basic/watch');
      node_watch.pos = [700, 200];
      graph.add(node_watch);

      node_const.connect(0, node_watch, 0);
    }

    graph.start();

    setLGraphInstance(graph);

    // Set an entry into the mapping so that we can get the current instance's state before unmounting
    instanceCbs[stateKey] = () => graph.serialize();
  });

  const uiControls = useMemo(
    () =>
      lGraphInstance
        ? {
            arrange: () => lGraphInstance.arrange(),
            clear: () => lGraphInstance.clear(),
          }
        : {},
    [lGraphInstance]
  );

  return (
    <div>
      <canvas
        ref={ref => (canvasRef.current = ref)}
        id='graph-editor'
        width={800}
        height={600}
      ></canvas>
      <button onClick={uiControls.arrange}>Arrange</button>
      <button onClick={uiControls.clear}>Clear</button>
    </div>
  );
};

export default GraphEditor;
