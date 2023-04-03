export type LineSpectrogramWorkerMessage =
  | {
      type: 'setWasmBytes';
      wasmBytes: ArrayBuffer;
      frequencyDataSAB: SharedArrayBuffer;
      notifySAB: SharedArrayBuffer;
    }
  | {
      type: 'setCanvas';
      canvas: OffscreenCanvas;
      dpr: number;
    }
  | { type: 'resizeCanvas'; width: number; height: number }
  | { type: 'start' }
  | { type: 'stop' };

export interface LineSpectrogramUIState {}

export const buildDefaultLineSpecrogramUIState = (): LineSpectrogramUIState => ({});
