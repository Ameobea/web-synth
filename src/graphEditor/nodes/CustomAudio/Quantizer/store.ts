export interface QuantizerNodeUIState {
  quantizationInterval: number;
}

export const buildDefaultQuantizerNodeUIState = (): QuantizerNodeUIState => ({
  quantizationInterval: 1,
});
