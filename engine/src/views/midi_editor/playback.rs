use super::prelude::*;

pub fn start_playback() {
    // Get an iterator of sorted attack/release events to process
    let events = state().note_lines.iter_events(None);

    // Create a virtual poly synth to handle assigning the virtual notes to voices
    let mut voice_manager = PolySynth::new(false);

    // Trigger all of the events with a custom callback that records the voice index to use for each
    // of them.
    // `scheduled_events` is an array of `(is_attack, voice_ix)` pairs represented as bytes for
    // efficient transfer across the FFI.
    let mut scheduled_events: Vec<u8> = Vec::with_capacity(events.size_hint().0 * 2);
    let mut frequencies: Vec<f32> = Vec::with_capacity(events.size_hint().0 / 2);
    let mut event_timings: Vec<f32> = Vec::with_capacity(events.size_hint().0);
    for event in events {
        let frequency = midi_to_frequency(event.line_ix);
        scheduled_events.push(tern(event.is_start, 1, 0));
        let event_time_seconds = ((event.beat / BPM) * 60.0) / 4.0;
        event_timings.push(event_time_seconds);

        if event.is_start {
            frequencies.push(frequency);
            voice_manager.trigger_attack_cb(frequency, |_, voice_ix, _| {
                scheduled_events.push(voice_ix as u8);
            });
        } else {
            voice_manager.trigger_release_cb(frequency, |_, voice_ix| {
                scheduled_events.push(voice_ix as u8);
            });
        }
    }

    // Ship all of these events over to be scheduled and played
    synth::schedule_events(
        state().synth.id,
        &scheduled_events,
        &frequencies,
        &event_timings,
    );
}
