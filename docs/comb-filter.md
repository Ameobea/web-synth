# comb-filter

A **comb filter** is a simple filter that is really just a delay.  They're incredibly simple to implement and very cheap as well.  The delay maps to a frequency of the filter.  For very small delays of ~2-~50 samples, it produces a tone.  For longer delays, it sounds closer to an echo which makes sense.

CCRMA link: <https://ccrma.stanford.edu/~jos/pasp/Feedforward_Comb_Filters.html>

Comb filters are useful for tons of technical DSP stuff, but they can also be used directly as audio effects.  That one Kikuo song sounds like it has one, where the duration of the delay/frequency of the filter is modulated from very high to very low.  Some Flume songs sound to me like they use comb filters as well.
