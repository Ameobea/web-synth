/**
 * Defines an interactive graph editor that can be used to route connections between different
 * components of an audio composition.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LiteGraph } from 'litegraph.js';
import 'litegraph.js/css/litegraph.css';
import ControlPanel, { Button } from 'react-control-panel';

import { store } from '../redux';
import { registerFaustNode } from './nodes/Faust';
import './GraphEditor.scss';
import { fetchEffects } from '../controls/EffectPicker';

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
  instance.stop();

  delete instaceMap[stateKey];
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

    (async () => {
      // Fetch the list of all available Faust modules if we don't have it loaded
      let availableModules:
        | {
            id: number;
            title: string;
            description: string;
            code: string;
          }[]
        | undefined = store.getState().effects.sharedEffects;

      if (availableModules) {
        availableModules = await fetchEffects();
      }

      // Register custom node types
      registerFaustNode(availableModules);

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
      instaceMap[stateKey] = graph;
    })();
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

export default GraphEditor;
