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
});

const GraphEditor: React.FC<{ stateKey: string } & ReturnType<typeof mapStateToProps>> = ({
  stateKey,
  patchNetwork,
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
      console.log(graph);
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
      instaceMap[stateKey] = graph;
    })();
  });

  const lastPatchNetwork = useRef<typeof patchNetwork | null>(null);
  useEffect(() => {
    if (lastPatchNetwork.current === patchNetwork) {
      return;
    }
    lastPatchNetwork.current = patchNetwork;

    // Patch network changed, so we have to update our state to match it
    console.log('Patch network updated: ', patchNetwork);
  }, [patchNetwork, lGraphInstance]);

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
    <div className='graph-editor-container'>
      <canvas
        ref={ref => (canvasRef.current = ref)}
        id='graph-editor'
        width={800}
        height={600}
      ></canvas>

      <ControlPanel>
        <Button label='arrange' action={uiControls.arrange} />
        <Button label='clear' action={uiControls.clear} />
      </ControlPanel>
    </div>
  );
};

export default connect(mapStateToProps)(GraphEditor);
