declare module 'tone';
declare module 'tone/Tone/*';
declare module 'react-control-panel';

declare var process: {
  env: {
    NODE_ENV: string;
    [key: string]: string;
  };
};

declare var WebAssembly: {
  Instance: any;
  Table: any;
  compile: (arrayBuffer: ArrayBuffer) => WebAssembly.Instance;
};
