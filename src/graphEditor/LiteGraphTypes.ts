import { AudioConnectables } from 'src/patchNetwork';

export interface LiteGraphNodePort {
  label: string;
  name: string;
  type: number;
}

export interface LiteGraphNodeInput extends LiteGraphNodePort {
  link: number;
}

export interface LiteGraphNodeOutput extends LiteGraphNodePort {
  links: number[];
}

export interface LiteGraphNode {
  id: string;
  graph: LiteGraph;
  inputs: LiteGraphNodeInput[];
  outputs: LiteGraphNodeOutput[];
  getInputNode: (inputSlotIx: number) => LiteGraphNode | undefined;
  getOutputNodes: (outputSlotIx: number) => LiteGraphNode[];
  connect: (srcSlotIx: number, dstNode: LiteGraphNode, dstSlotIx: number) => void;
  disconnectOutput: (srcSlot: number | string, dstNode: LiteGraphNode) => boolean;
}

export interface LiteGraphConnectablesNode extends LiteGraphNode {
  type: 'audio/audioConnectables';
  setConnectables: (connectables: AudioConnectables) => void;
  connectables: AudioConnectables;
}

export interface LiteGraphLink {
  origin_id: string;
  origin_slot: number;
  target_id: string;
  target_slot: number;
}

export interface LiteGraph {
  links: { [id: string]: LiteGraphLink };
  _nodes: LiteGraphNode[];
  _nodes_by_id: { [id: string]: LiteGraphNode };
  add: (node: LiteGraphNode) => void;
  remove: (node: LiteGraphNode) => void;
  arrange: () => void;
}
