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
