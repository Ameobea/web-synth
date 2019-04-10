declare module 'tone*';
declare module 'react-control-panel';

declare class FaustWasm2ScriptProcessor {
  constructor(name: string, props: {}, options: {});

  getNode(wasmInstance: any, audioContext: AudioContext, bufferSize: number): ScriptProcessorNode;
}
