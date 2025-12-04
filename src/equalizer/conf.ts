import { EqualizerFilterType } from 'src/equalizer/eqHelpers';
import { SAMPLE_RATE } from 'src/util';

export const EQ_X_DOMAIN: [number, number] = [10, SAMPLE_RATE / 2];
export const EQ_GAIN_DOMAIN: [number, number] = [-50, 25];
/**
 * For lowpass and highpass filters the Q value is interpreted to be in dB.
 *
 * For the bandpass, notch, allpass, and peaking filters, Q is a linear value. The value is
 * related to the bandwidth of the filter and hence should be a positive value.
 *
 * https://webaudio.github.io/web-audio-api/#dom-biquadfilternode-q
 *
 * HOWEVER, the biquad implementation on the backend expects all Q values to be in dB and
 * converts them to linear internally for the filter types that require it.  So, all Q
 * values should be in dB for all filter types.
 */
export const EQ_Q_DOMAIN: [number, number] = EQ_GAIN_DOMAIN;
export const EQ_AXIS_MARGIN = { top: 10, right: 0, bottom: 24, left: 34 } as const;
export const EQ_MAX_AUTOMATED_PARAM_COUNT = 4;

export const HANDLE_COLOR_BY_FILTER_TYPE: Record<EqualizerFilterType, string> = {
  [EqualizerFilterType.Lowpass]: '#18a324',
  [EqualizerFilterType.Order4Lowpass]: '#18a324',
  [EqualizerFilterType.Order8Lowpass]: '#18a324',
  [EqualizerFilterType.Order16Lowpass]: '#18a324',
  [EqualizerFilterType.Highpass]: '#a12f13',
  [EqualizerFilterType.Order4Highpass]: '#a12f13',
  [EqualizerFilterType.Order8Highpass]: '#a12f13',
  [EqualizerFilterType.Order16Highpass]: '#a12f13',
  [EqualizerFilterType.Bandpass]: '#9024ad',
  [EqualizerFilterType.Notch]: '#838f18',
  [EqualizerFilterType.Peak]: '#abab11',
  [EqualizerFilterType.Lowshelf]: '#18a35c',
  [EqualizerFilterType.Highshelf]: '#a14c13',
  [EqualizerFilterType.Allpass]: '#8b8b8b',
  [EqualizerFilterType.Dynabandpass]: '#ad186cff',
};
