import { Try } from 'funfix-core';

export const clamp = (min: number, max: number, val: number) => Math.min(Math.max(val, min), max);

/**
 * Rounds a number to the specified number of decimals and returns it.
 *
 * @param num number to round
 * @param decimals number of decimal places to round it to
 */
export const roundTo = (num: number, decimals: number): number => {
  const multiplicand = Math.pow(10, decimals);
  return Math.round(num * multiplicand) / multiplicand;
};

export const midiToFrequency = (midiNote: number) => Math.pow(2, (midiNote - 69) / 12) * 440;

/**
 * Tries to parse the provided string out of JSON.
 **/
export const tryParseJson = <T, D = T>(
  serialized: string,
  defaultValue: D,
  errMsg?: string
): T | D =>
  Try.of(() => JSON.parse(serialized) as T).getOrElseL(() => {
    console.warn(errMsg || 'Failed to parse JSON; falling back to default value.');
    return defaultValue;
  });
