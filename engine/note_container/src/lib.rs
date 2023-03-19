//! Note container - a container to hold notes or other entities in things like the MIDI editor and
//! the track compositor.  Exposes a simple interface through which to query and modify the
//! container as well as a wrapper container to hold note containers for multiple rows/lines as is
//! needed by these use cases.

#![feature(vec_into_raw_parts)]

pub mod exports;
pub mod note_container;
pub mod note_lines;
