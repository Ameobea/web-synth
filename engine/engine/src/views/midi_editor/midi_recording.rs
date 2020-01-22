use wasm_bindgen::prelude::*;

use super::*;

#[derive(Clone, Copy)]
pub struct ActiveVoice {
    pub playing_start_time_seconds: f64,
    pub note_id: usize,
}

pub struct MIDIRecordingContext {
    pub active_voices: [Option<ActiveVoice>; 32],
}

impl Default for MIDIRecordingContext {
    fn default() -> Self {
        MIDIRecordingContext {
            active_voices: [None; 32],
        }
    }
}

pub fn start_recording_midi(
    handler: &mut MIDIEditorGridHandler,
    grid_state: &mut GridState<usize>,
    cur_time: f64,
) -> *mut MIDIRecordingContext {
    let recording_ctx = box MIDIRecordingContext::default();

    Box::into_raw(recording_ctx)
}

pub fn stop_recording_midi(
    handler: &mut MIDIEditorGridHandler,
    grid_state: &mut GridState<usize>,
    recording_ctx_ptr: *mut MIDIRecordingContext,
    cur_time: f64,
) {
    let recording_ctx = unsafe { Box::from_raw(recording_ctx_ptr) };
    // TODO: Stop animations, clear currently pressed/drawn notes
    drop(recording_ctx);
}

#[wasm_bindgen]
pub fn midi_editor_record_note_down(
    recording_ctx_ptr: *mut MIDIRecordingContext,
    cur_time: f64,
    note_id: usize,
) {
    let recording_ctx = unsafe { Box::from_raw(recording_ctx_ptr) };
    unimplemented!(); // TODO
    std::mem::forget(recording_ctx);
}

#[wasm_bindgen]
pub fn midi_editor_record_note_up(
    recording_ctx_ptr: *mut MIDIRecordingContext,
    cur_time: f64,
    note_id: usize,
) {
    let recording_ctx = unsafe { Box::from_raw(recording_ctx_ptr) };
    unimplemented!(); // TODO
    std::mem::forget(recording_ctx);
}
