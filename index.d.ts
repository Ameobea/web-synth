import { LiteGraphNode } from 'src/graphEditor/LiteGraphTypes';

declare module 'tone';
declare module 'tone/Tone/*';
declare module 'react-control-panel';

declare module 'litegraph.js' {
  namespace LiteGraph {
    const createNode: (type: string, opts?: { [key: string]: any }) => LiteGraphNode;
  }
}

declare const process: {
  env: {
    NODE_ENV: string;
    [key: string]: string;
  };
};
