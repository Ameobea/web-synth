#![feature(box_syntax)]

//! Utilities for generating waveforms and wavetables using inverse FFT.

#[cfg(test)]
mod tests;

#[cfg(feature = "bindgen")]
mod bindings;
