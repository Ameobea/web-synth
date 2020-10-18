declare module 'react-control-panel';

declare module 'litegraph.js' {
  import { LiteGraphNode } from 'src/graphEditor/LiteGraphTypes';

  namespace LiteGraph {
    export const createNode: ((type: string, options?: { [key: string]: any }) => LiteGraphNode) &
      ((type: string, title: string, opts?: { [key: string]: any }) => LiteGraphNode);
    const registerNodeType: (type: string, nodeClass: any) => void;

    export class LGraph {
      start: () => void;
    }

    export class LGraphCanvas {
      constructor(id: string, graph: LGraph);

      onNodeSelected?: (node: any) => void | undefined;
      onNodeDeselected?: (node: any) => void | undefined;
    }
  }

  export namespace LGAudio {
    export const getAudioContext: () => AudioContext;

    export const createAudioNodeWrapper: (node: any) => void;
  }
}

declare const process: {
  env: {
    NODE_ENV: string;
    [key: string]: string;
  };
};

declare function dbg<T>(arg: T): T;
