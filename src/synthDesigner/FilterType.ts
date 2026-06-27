export enum FilterType {
  Lowpass = 'lowpass',
  LP4 = 'order 4 lowpass',
  LP8 = 'order 8 lowpass',
  LP16 = 'order 16 lowpass',
  Highpass = 'highpass',
  HP4 = 'order 4 highpass',
  HP8 = 'order 8 highpass',
  HP16 = 'order 16 highpass',
  Bandpass = 'bandpass',
  BP4 = 'order 4 bandpass',
  BP8 = 'order 8 bandpass',
  BP16 = 'order 16 bandpass',
  DynaBP_50 = 'dynamic bandpass (50 Hz)',
  DynaBP_100 = 'dynamic bandpass (100 Hz)',
  DynaBP_200 = 'dynamic bandpass (200 Hz)',
  DynaBP_400 = 'dynamic bandpass (400 Hz)',
  DynaBP_800 = 'dynamic bandpass (800 Hz)',
  Lowshelf = 'lowshelf',
  Highshelf = 'highshelf',
  Peaking = 'peaking',
  Notch = 'notch',
  Allpass = 'allpass',
}

/**
 * Numeric encoding sent to the Wasm engine and the filter response viz.  Must match the `FilterType`
 * enum discriminants in `engine/wavetable/src/fm/filter/mod.rs`.
 */
export const encodeFilterType = (filterType: FilterType): number =>
  ({
    [FilterType.Lowpass]: 0,
    [FilterType.LP4]: 1,
    [FilterType.LP8]: 2,
    [FilterType.LP16]: 3,
    [FilterType.Highpass]: 4,
    [FilterType.HP4]: 5,
    [FilterType.HP8]: 6,
    [FilterType.HP16]: 7,
    [FilterType.Bandpass]: 8,
    [FilterType.BP4]: 9,
    [FilterType.BP8]: 10,
    [FilterType.BP16]: 11,
    [FilterType.DynaBP_50]: 12,
    [FilterType.DynaBP_100]: 13,
    [FilterType.DynaBP_200]: 14,
    [FilterType.DynaBP_400]: 15,
    [FilterType.DynaBP_800]: 16,
    [FilterType.Lowshelf]: 17,
    [FilterType.Highshelf]: 18,
    [FilterType.Peaking]: 19,
    [FilterType.Notch]: 20,
    [FilterType.Allpass]: 21,
  })[filterType];
