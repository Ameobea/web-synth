/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */

import React, { useEffect, useRef } from 'react';

import { LiteGraph } from 'litegraph.js';

const GraphEditor: React.FC<{}> = () => {
  const isInitialized = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (isInitialized.current || !canvasRef.current) {
      return;
    }
    isInitialized.current = true;

    const graph = new LiteGraph.LGraph();
    const _canvas = new LiteGraph.LGraphCanvas('#graph-editor', graph);

    const node_const = LiteGraph.createNode('basic/const');
    node_const.pos = [200, 200];
    graph.add(node_const);
    node_const.setValue(4.5);

    const node_watch = LiteGraph.createNode('basic/watch');
    node_watch.pos = [700, 200];
    graph.add(node_watch);

    node_const.connect(0, node_watch, 0);

    graph.start();
  }, []);

  return (
    <div>
      <canvas
        ref={ref => (canvasRef.current = ref)}
        id='graph-editor'
        width={800}
        height={800}
      ></canvas>
    </div>
  );
};

export default GraphEditor;
