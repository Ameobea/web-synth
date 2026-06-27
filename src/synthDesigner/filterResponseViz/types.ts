export type FilterResponseVizWorkerMessage =
  | { type: 'setWasmBytes'; wasmBytes: ArrayBuffer; sab: SharedArrayBuffer }
  | { type: 'setCanvas'; canvas: OffscreenCanvas; dpr: number; dbDomain: [number, number]; lineColor: string }
  | { type: 'setFilterType'; filterType: number }
  | { type: 'setActive'; active: boolean };
