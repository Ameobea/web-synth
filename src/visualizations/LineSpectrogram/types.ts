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

export interface LineSpectrogramUIState {
  rangeDb: [number, number];
  smoothingCoeff: number;
}

export const buildDefaultLineSpecrogramUIState = (): LineSpectrogramUIState => ({
  rangeDb: [-80, -20],
  smoothingCoeff: 0.9,
});
