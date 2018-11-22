use super::*;

pub fn tern<T>(cond: bool, if_true: T, if_false: T) -> T {
    if cond {
        if_true
    } else {
        if_false
    }
}

pub fn clamp(val: f32, min: f32, max: f32) -> f32 { val.max(min).min(max) }

pub fn midi_to_frequency(line_ix: usize) -> f32 {
    27.5 * (2.0f32).powf(((LINE_COUNT - line_ix) as f32) / 12.0)
}

pub fn snap_to_beat_interval(px: usize, lower_bound_px: f32) -> f32 {
    let beat = px_to_beat(px as f32);
    let beats_to_shave = beat % NOTE_SNAP_BEAT_INTERVAL;
    beats_to_px(beat - beats_to_shave).max(lower_bound_px)
}

pub fn get_line_index(y: usize) -> Option<usize> {
    if y > CURSOR_GUTTER_HEIGHT {
        Some(((y - CURSOR_GUTTER_HEIGHT) as f32 / (PADDED_LINE_HEIGHT as f32)).trunc() as usize)
    } else {
        None
    }
}

pub fn px_to_beat(px: f32) -> f32 { px / BEAT_LENGTH_PX }

pub fn beats_to_px(beats: f32) -> f32 { beats * BEAT_LENGTH_PX }

pub fn deselect_all_notes() {
    for note_data in state().selected_notes.drain() {
        deselect_note(note_data.dom_id);
    }
}
