import { SAMPLE_RATE } from 'src/util';

export const FILTER_VIZ_WIDTH = 600;
export const FILTER_VIZ_HEIGHT = 250;
export const FILTER_VIZ_MARGIN = { top: 8, right: 6, bottom: 20, left: 32 } as const;
/** Must match the log-spaced grid the Wasm computes over (`START_FREQ`..nyquist). */
export const FILTER_VIZ_X_DOMAIN: [number, number] = [10, SAMPLE_RATE / 2];
export const FILTER_VIZ_DB_DOMAIN: [number, number] = [-40, 20];
export const FILTER_VIZ_LINE_COLOR = '#e8e8e8';

export const FILTER_VIZ_PLOT_WIDTH =
  FILTER_VIZ_WIDTH - FILTER_VIZ_MARGIN.left - FILTER_VIZ_MARGIN.right;
export const FILTER_VIZ_PLOT_HEIGHT =
  FILTER_VIZ_HEIGHT - FILTER_VIZ_MARGIN.top - FILTER_VIZ_MARGIN.bottom;
