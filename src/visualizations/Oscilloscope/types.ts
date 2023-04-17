export enum OscilloscopeWindowType {
  Beats = 0,
  Seconds = 1,
  Samples = 2,
  Wavelengths = 3,
}

export interface OscilloscopeWindow {
  type: OscilloscopeWindowType;
  value: number;
}

export type OscilloscopeWorkerMessage =
  | { type: 'setSAB'; sab: SharedArrayBuffer }
  | { type: 'setWasmBytes'; wasmBytes: ArrayBuffer }
  | { type: 'setView'; view: OffscreenCanvas; dpr: number }
  | { type: 'setWindow'; window: OscilloscopeWindow }
  | { type: 'setFrozen'; frozen: boolean }
  | { type: 'setFrameByFrame'; frameByFrame: boolean }
  | { type: 'resizeView'; newWidth: number; newHeight: number }
  | { type: 'setSnapF0ToMIDI'; snapF0ToMIDI: boolean };

export interface OscilloscopeUIState {
  window: OscilloscopeWindow;
  lastValueByWindowType: Record<OscilloscopeWindowType, number>;
  frozen: boolean;
  frameByFrame: boolean;
  snapF0ToMIDI: boolean;
}

export const buildDefaultOscilloscopeUIState = (): OscilloscopeUIState => ({
  window: {
    type: OscilloscopeWindowType.Seconds,
    value: 2,
  },
  lastValueByWindowType: {
    [OscilloscopeWindowType.Beats]: 4,
    [OscilloscopeWindowType.Seconds]: 2,
    [OscilloscopeWindowType.Samples]: 44_100,
    [OscilloscopeWindowType.Wavelengths]: 2,
  },
  frozen: false,
  frameByFrame: true,
  snapF0ToMIDI: false,
});
