declare module 'tone';
declare module 'tone/Tone/*';
declare module 'react-control-panel';

interface FaustModuleInstance extends ScriptProcessorNode {
  getParamValue: (path: string) => number;
  setParamValue: (path: string, val: number) => void;
}

declare class FaustWasm2ScriptProcessor {
  constructor(name: string, props: {}, options: {});

  getNode(wasmInstance: any, audioContext: AudioContext, bufferSize: number): FaustModuleInstance;
}

declare var process: {
  env: {
    NODE_ENV: string;
  };
};
