import { SAMPLE_RATE } from 'src/util';

export const EQ_X_DOMAIN: [number, number] = [10, SAMPLE_RATE / 2];
export const EQ_Y_DOMAIN: [number, number] = [-40, 20];
export const EQ_AXIS_MARGIN = { top: 10, right: 0, bottom: 24, left: 34 } as const;
export const EQ_MAX_AUTOMATED_PARAM_COUNT = 4;
