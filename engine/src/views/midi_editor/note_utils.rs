//! Utilities for manipulating and interacting with notes and other elements of the UI

use std::f32;

use fnv::FnvHashSet;

use super::prelude::*;

pub fn copy_selected_notes() {
    let (earliest_start_beat, latest_end_beat) = state().selected_notes.iter().fold(
        (f32::INFINITY, f32::NEG_INFINITY),
        |(cur_earliest_start, cur_latest_end_beat),
         SelectedNoteData {
             start_beat, width, ..
         }| {
            (
                cur_earliest_start.min(*start_beat),
                cur_latest_end_beat.max(start_beat + width),
            )
        },
    );
    if earliest_start_beat == f32::INFINITY {
        return;
    }

    let offset_beats = state().cursor_pos_beats - earliest_start_beat;
    let mut new_selected_notes = FnvHashSet::default();
    new_selected_notes.reserve(state().selected_notes.len());
    for SelectedNoteData {
        start_beat,
        width,
        line_ix,
        dom_id,
    } in state().selected_notes.iter()
    {
        render::deselect_note(*dom_id);
        let new_start_beat = start_beat + offset_beats;
        let new_end_beat = start_beat + width + offset_beats;
        // try to insert a note `offset_beats` away from the previous note on the same line
        if let skip_list::Bounds::Bounded(start_bound, end_bound_opt) = state()
            .note_lines
            .get_bounds(*line_ix, new_start_beat + (width / 0.5))
        {
            if start_bound > new_start_beat
                || (end_bound_opt
                    .map(|end_bound| end_bound < new_end_beat)
                    .unwrap_or(false))
            {
                // unable to place note at this position
                continue;
            }
        }
        let dom_id = render::draw_note(*line_ix, beats_to_px(new_start_beat), beats_to_px(*width));
        let new_note = NoteBox {
            start_beat: start_beat + offset_beats,
            end_beat: start_beat + width + offset_beats,
            dom_id,
        };
        let insertion_failed = state().note_lines.insert(*line_ix, new_note);
        debug_assert!(!insertion_failed);
        render::select_note(dom_id);
        new_selected_notes.insert(SelectedNoteData::from_note_box(*line_ix, &new_note));
    }

    // deselect the old notes and select the new ones
    state().selected_notes = new_selected_notes;

    // move the cursor forward
    let clipboard_end_beat = tern(
        state().cursor_pos_beats < latest_end_beat,
        latest_end_beat,
        earliest_start_beat + offset_beats.abs(),
    );
    let clipboard_width_beats = clipboard_end_beat - earliest_start_beat;
    render::set_cursor_pos(state().cursor_pos_beats + clipboard_width_beats);
}

pub fn play_selected_notes() {
    for SelectedNoteData { line_ix, .. } in state().selected_notes.iter() {
        state().synth.trigger_attack(midi_to_frequency(*line_ix));
    }
}

pub fn release_selected_notes() {
    for SelectedNoteData { line_ix, .. } in state().selected_notes.iter() {
        state().synth.trigger_release(midi_to_frequency(*line_ix));
    }
}
