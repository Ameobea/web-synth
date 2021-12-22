export enum QuantizeMode {
  Round = 0,
  Floor = 1,
  Ceil = 2,
  Trunc = 3,
}

export interface QuantizerNodeUIState {
  customValueEntry: string;
  mode: QuantizeMode;
  quantizationInterval: { type: 'custom'; value: number } | { type: 'preset'; value: number };
}

export const buildDefaultQuantizerNodeUIState = (): QuantizerNodeUIState => ({
  customValueEntry: '',
  mode: QuantizeMode.Trunc,
  quantizationInterval: { type: 'preset', value: 1 },
});

export const tryParseCustomQuantizationIntervalValue = (
  customValueEntry: string
): { type: 'success'; value: number } | { type: 'error'; message: string } => {
  console.log({ tryParse: customValueEntry });
  // Remove all whitesace
  customValueEntry = customValueEntry.replaceAll(/\s/g, '');
  if (!customValueEntry.includes('/')) {
    const parsed = +customValueEntry;
    if (Number.isNaN(parsed)) {
      return { type: 'error', message: 'Enter a valid number' };
    } else if (parsed < 0) {
      return { type: 'error', message: 'Provided number must be positive' };
    }
    return { type: 'success', value: parsed };
  }

  const spl = customValueEntry.split('/');
  if (spl.length !== 2) {
    return { type: 'error', message: 'Expected exactly one / when providing a fraction' };
  }

  const [numerator, denominator] = spl;
  const parsedNumerator = +numerator;
  if (Number.isNaN(parsedNumerator)) {
    return { type: 'error', message: 'Numerator is not a valid number' };
  }
  const parsedDenominator = +denominator;
  if (Number.isNaN(parsedDenominator)) {
    return { type: 'error', message: 'Denominator is not a valid number' };
  }

  return { type: 'success', value: parsedNumerator / parsedDenominator };
};
