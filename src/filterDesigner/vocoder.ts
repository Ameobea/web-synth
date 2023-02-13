import { buildHighOrderBandpassFilters } from 'src/filterDesigner/higherOrderBandpass';
import type { SerializedFilterDesigner } from 'src/filterDesigner/util';
import type { FilterParams } from 'src/redux/modules/synthDesigner';

const computeDynaBandpassModifiedBandWidth = (
  baseFrequency: number,
  baseBandWidth: number,
  frequency: number
) => {
  const logBaseFrequency = Math.log10(baseFrequency + baseBandWidth / 2);
  const logFrequency = Math.log10(frequency);
  const logBaseBandWidth = Math.log10(baseBandWidth);
  return Math.pow(10, logBaseBandWidth + (logFrequency - logBaseFrequency));
};

/**
 * In the same was as we did in the dynabandpass filter, we need to make the band widths
 * of the vocoder bands grow exponentially as we move up in frequency since frequency
 * is logarithmic.
 */
const computeBandWidth = (startFreqHz: number, baseBandWidthHz: number) =>
  computeDynaBandpassModifiedBandWidth(10, baseBandWidthHz, startFreqHz);

const computeBandSpacingHz = (bandEndFreqHz: number, baseBandSpacingHz: number) =>
  computeDynaBandpassModifiedBandWidth(10, baseBandSpacingHz, bandEndFreqHz);

export const buildVocoderBandpassChainPreset = (filterOrder: 16 | 24): SerializedFilterDesigner => {
  const startFreqHz = 10;

  let BaseBandWidthHz = 2;
  let groupCount = 36;
  let baseBandSpacingHz = 0.4;
  switch (filterOrder) {
    case 24:
      BaseBandWidthHz = 2;
      groupCount = 36;
      baseBandSpacingHz = 0.4;
      break;
    case 16:
      BaseBandWidthHz = 3.8;
      groupCount = 22;
      baseBandSpacingHz = 0.8;
      break;
    default:
      throw new Error('Invalid filter order: ' + filterOrder);
  }

  const filterGroups: FilterParams[][] = [];
  let curBandStartFreqHz = startFreqHz;
  for (let groupIx = 0; groupIx < groupCount; groupIx += 1) {
    const bandWidth = computeBandWidth(curBandStartFreqHz, BaseBandWidthHz);
    const curBandEndFreqHz = curBandStartFreqHz + bandWidth;
    const curBandCenterFreqHz = curBandStartFreqHz + bandWidth / 2;
    const filters = buildHighOrderBandpassFilters(filterOrder, bandWidth, curBandCenterFreqHz);
    filterGroups.push(filters);

    const spacingHz = computeBandSpacingHz(curBandEndFreqHz, baseBandSpacingHz);
    curBandStartFreqHz = curBandEndFreqHz + spacingHz;
  }

  return {
    filterGroups,
    lockedFrequencyByGroup: new Array(groupCount).fill(null),
  };
};
