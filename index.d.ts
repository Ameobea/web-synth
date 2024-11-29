import type { AudioConnectables } from 'src/patchNetwork';
import type { Renderable, ToastOptions } from 'svelte-french-toast';

declare module 'litegraph.js' {
  import type {
    LiteGraphNode,
    LiteGraph as LiteGraphInstance,
    LiteGraphLink,
  } from 'src/graphEditor/LiteGraphTypes';

  namespace LiteGraph {
    export const createNode: ((type: string, options?: { [key: string]: any }) => LiteGraphNode) &
      ((type: string, title: string, opts?: { [key: string]: any }) => LiteGraphNode);
    const registerNodeType: (type: string, nodeClass: any) => void;
    const registered_node_types: { [nodeType: string]: any };

    export class LGraphCanvas {
      constructor(id: string, graph: LiteGraphInstance);

      onNodeSelected?: (node: any) => void | undefined;
      onNodeDeselected?: (node: any) => void | undefined;
    }

    export class LGraph implements LiteGraphInstance {
      list_of_graphcanvas: any[];
      links: { [id: string]: LiteGraphLink };
      _nodes: LiteGraphNode[];
      _nodes_by_id: { [id: string]: LiteGraphNode };
      add: (node: LiteGraphNode) => void;
      remove: (node: LiteGraphNode) => void;
      arrange: () => void;
      start: () => void;
      onNodeRemoved?: ((node: any) => void | undefined) | undefined;
      serialize(): { [key: string]: any };
      setDirtyCanvas: (foreground: boolean, background: boolean) => void;
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

declare global {
  declare function dbg<T>(arg: T): T;

  declare function toast(msg: Renderable, options?: ToastOptions): void;
  declare function toastSuccess(msg: Renderable, options?: ToastOptions): void;
  declare function toastError(msg: Renderable, options?: ToastOptions): void;

  declare function updateConnectables(vcId: string, newConnectables: AudioConnectables): void;

  declare function genRandomStringID(): string;
}
