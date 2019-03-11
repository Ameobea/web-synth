//! Contains constants used to define things about many parts of the application

/// Height of one of the lines rendered in the grid
pub const LINE_HEIGHT: usize = 12;
pub const NOTES_PER_OCTAVE: usize = 12; // A,Bb,B,C,C#,D,Eb,E,F,F#,G,Ab
pub const OCTAVES: usize = 5;
pub const LINE_COUNT: usize = OCTAVES * NOTES_PER_OCTAVE;
pub const CURSOR_GUTTER_HEIGHT: usize = 16;
pub const LINE_BORDER_WIDTH: usize = 1;
pub const PADDED_LINE_HEIGHT: usize = LINE_HEIGHT + LINE_BORDER_WIDTH;
pub const GRID_HEIGHT: usize = LINE_COUNT * PADDED_LINE_HEIGHT - 1;
/// How long one beat is in pixels
pub const BEAT_LENGTH_PX: f32 = 20.0;
pub const MEASURE_COUNT: usize = 16;
pub const BEATS_PER_MEASURE: usize = 4;
pub const MEASURE_WIDTH_PX: f32 = BEATS_PER_MEASURE as f32 * BEAT_LENGTH_PX;
pub const GRID_WIDTH: usize = MEASURE_COUNT * (MEASURE_WIDTH_PX as usize);

pub const NOTE_SNAP_BEAT_INTERVAL: f32 = 0.5;

pub const BPM: f32 = 50.0;
