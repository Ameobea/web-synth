//! The MIDI editor is the view that is used to actually create music.  It renders a stack of rows
//! that correspond to individual notes.  It supports operations like dragging notes around,
//! selecting/deleting notes, and playing the current composition.

use super::super::view_context::ViewContext;

pub mod composition_saving_loading;
pub mod constants;
pub mod input_handlers;
pub mod note_utils;
pub mod playback;
pub mod prelude;
pub mod state;
pub mod util;

pub struct MidiEditor(state::State);

impl ViewContext for MidiEditor {}
