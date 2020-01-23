use wasm_bindgen::prelude::*;

use super::*;

#[derive(Clone, Copy)]
pub struct ActiveVoice {
    pub playing_start_time_seconds: f64,
    pub note_id: usize,
    pub dom_id: DomId,
}

pub struct MIDIRecordingContext {
    pub initial_cursor_pos_beats: f64,
    pub start_time_seconds: f64,
    pub state: &'static mut MIDIEditorGridHandler,
    pub grid_state: &'static mut GridState<usize>,
    pub active_voices: [Option<ActiveVoice>; 32],
    pub animation_cb: Closure<(dyn std::ops::FnMut(f64) + 'static)>,
    pub animation_loop_handle: usize,
}

impl MIDIRecordingContext {
    fn new(
        state: &mut MIDIEditorGridHandler,
        grid_state: &mut GridState<usize>,
        start_time_seconds: f64,
    ) -> Self {
        MIDIRecordingContext {
            initial_cursor_pos_beats: grid_state.cursor_pos_beats as f64,
            start_time_seconds,
            // We assume that the underlying MIDI editor doesn't get destroyed while this exists...
            state: unsafe { std::mem::transmute(state) },
            grid_state: unsafe { std::mem::transmute(grid_state) },
            active_voices: [None; 32],
            animation_cb: Closure::new(|_| {}),
            animation_loop_handle: 0,
        }
    }
}

/// RAII-style helper that derefs a raw pointer to a `MIDIEditorRecordingContext`, runs the provided
/// closure, and then forgets the box to avoid `free()`ing the underlying context.
fn with_ctx<F: Fn(&mut MIDIRecordingContext) -> ()>(
    recording_ctx_ptr: *mut MIDIRecordingContext,
    cb: F,
) {
    let mut recording_ctx = unsafe { Box::from_raw(recording_ctx_ptr) };
    cb(&mut *recording_ctx);
    std::mem::forget(recording_ctx);
}

fn do_midi_recorder_animation_tick(ctx_ptr: *mut MIDIRecordingContext, cur_time: f64) {
    with_ctx(ctx_ptr, |recording_ctx| {
        let total_seconds_recorded = cur_time - recording_ctx.start_time_seconds;
        let total_beats_recorded = recording_ctx.state.time_to_beats(total_seconds_recorded);
        let cur_cursor_pos_beats = recording_ctx.initial_cursor_pos_beats + total_beats_recorded;
        let cursor_pos_px = recording_ctx
            .grid_state
            .conf
            .beats_to_px(cur_cursor_pos_beats as f32);

        // Update cursor position both visually and in the grid state
        recording_ctx.grid_state.cursor_pos_beats = cur_cursor_pos_beats as f32;
        MidiEditorGridRenderer::set_cursor_pos(
            recording_ctx.grid_state.cursor_dom_id,
            cursor_pos_px,
        );

        // Visually extend all currently playing notes
        for entry_opt in &recording_ctx.active_voices {
            if let Some(entry) = entry_opt {
                let note_length_seconds = cur_time - entry.playing_start_time_seconds;
                let note_length_beats = recording_ctx.state.time_to_beats(note_length_seconds);

                js::set_attr(
                    entry.dom_id,
                    "width",
                    &(recording_ctx
                        .grid_state
                        .conf
                        .beats_to_px(note_length_beats as f32)
                        .to_string()),
                )
            }
        }
    });
}

pub fn start_recording_midi(
    state: &mut MIDIEditorGridHandler,
    grid_state: &mut GridState<usize>,
    cur_time: f64,
) -> *mut MIDIRecordingContext {
    let recording_ctx = box MIDIRecordingContext::new(state, grid_state, cur_time);
    let ctx_ptr = Box::into_raw(recording_ctx);
    let animation_cb_closure = Closure::wrap(
        (box move |cur_time: f64| {
            do_midi_recorder_animation_tick(ctx_ptr, cur_time);
        }) as Box<dyn FnMut(f64)>,
    );
    let animation_loop_handle = js::midi_editor_register_animation_frame(&animation_cb_closure);
    unsafe {
        (*ctx_ptr).animation_cb = animation_cb_closure;
        (*ctx_ptr).animation_loop_handle = animation_loop_handle;
    };

    ctx_ptr
}

pub fn stop_recording_midi(recording_ctx_ptr: *mut MIDIRecordingContext, _cur_time: f64) {
    let recording_ctx = unsafe { Box::from_raw(recording_ctx_ptr) };

    // Cancel all currently playing notes, destroying their note box UI elements.
    for entry in &recording_ctx.active_voices {
        if let Some(entry) = entry {
            js::delete_element(entry.dom_id);
        }
    }

    // Cancel the animation loop
    js::midi_editor_cancel_animation_frame(recording_ctx.animation_loop_handle);

    drop(recording_ctx);
}

#[wasm_bindgen]
pub fn midi_editor_record_note_down(
    recording_ctx_ptr: *mut MIDIRecordingContext,
    cur_time: f64,
    note_id: usize,
) {
    with_ctx(recording_ctx_ptr, |recording_ctx| {
        // Check that the note isn't already playing
        //
        // Iteration of a fixed-size 32 elem array is almost certainly faster than hashmap or
        // sth. like that
        let mut first_empty_ix: Option<usize> = None;
        for (i, slot) in recording_ctx.active_voices.iter().enumerate() {
            match slot {
                Some(voice) if note_id == voice.note_id => {
                    warn!(
                        "MIDI recorder registered key down for note id {} but one is already down \
                         for that note id",
                        note_id
                    );
                    return;
                },
                None if first_empty_ix.is_none() => first_empty_ix = Some(i),
                _ => (),
            }
        }

        if let Some(first_empty_ix) = first_empty_ix {
            // TODO: Support time offsets for input delay
            let start_beat = recording_ctx.state.time_to_beats(cur_time);
            let line_ix = recording_ctx.grid_state.conf.row_count - note_id;

            let dom_id = MidiEditorGridRenderer::create_note(
                recording_ctx.grid_state.conf.beats_to_px(start_beat as f32),
                recording_ctx.grid_state.conf.cursor_gutter_height
                    + recording_ctx.grid_state.conf.padded_line_height() * line_ix,
                0,
                recording_ctx.grid_state.conf.line_height,
                None,
            );
            MidiEditorGridRenderer::select_note(dom_id);

            recording_ctx.active_voices[first_empty_ix] = Some(ActiveVoice {
                note_id,
                playing_start_time_seconds: cur_time,
                dom_id,
            });
        } else {
            warn!("No non-playing voices in midi recorder; ignoring note down event...");
            return;
        }
    });
}

#[wasm_bindgen]
pub fn midi_editor_record_note_up(
    recording_ctx_ptr: *mut MIDIRecordingContext,
    cur_time: f64,
    note_id: usize,
) {
    with_ctx(recording_ctx_ptr, |recording_ctx| {
        let voice_entry_ix = match recording_ctx
            .active_voices
            .iter()
            .position(|item| match item {
                Some(voice) => voice.note_id == note_id,
                None => false,
            }) {
            Some(pos) => pos,
            None => {
                warn!(
                    "No playing note with note id {} found in MIDI recorder; ignoring note up \
                     event...",
                    note_id
                );
                return;
            },
        };

        let entry: ActiveVoice =
            std::mem::replace(&mut recording_ctx.active_voices[voice_entry_ix], None).unwrap();
        // Commit this new note to the skip list and render it officially so that the grid knows
        // about it and can delete/move it etc.
        let note: NoteBox<usize> = NoteBox {
            data: entry.dom_id,
            bounds: NoteBoxBounds {
                start_beat: (recording_ctx
                    .state
                    .time_to_beats(cur_time - entry.playing_start_time_seconds)
                    + recording_ctx.initial_cursor_pos_beats) as f32,
                // TODO: snap to beat
                end_beat: recording_ctx
                    .state
                    .time_to_beats(cur_time - entry.playing_start_time_seconds)
                    as f32,
            },
        };
        MidiEditorGridRenderer::deselect_note(entry.dom_id);

        let line_ix = recording_ctx.grid_state.conf.row_count - entry.note_id;
        let insertion_err = recording_ctx.grid_state.data.insert(line_ix, note);
        if let Some(_) = insertion_err {
            error!("Unable to insert note in MIDI recorder due to intersecting note");
            crate::js::delete_element(entry.dom_id);
        }
    });
}
