export const roundTo = (num: number, decimals: number): number => {
  const multiplicand = Math.pow(10, decimals);
  return Math.round(num * multiplicand) / multiplicand;
};
