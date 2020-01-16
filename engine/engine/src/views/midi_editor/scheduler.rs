//! Scheduler for notes of the MIDI editor.  Allows for a composition to be played through or for
//! part of it to be looped continuously.

use super::{LoopMarkDescriptor, MIDIEditorGridHandler, MidiEditorGridRenderer};
use crate::helpers::grid::prelude::*;

pub type SchedulerStateHandle = *mut SchedulerState;
pub type SchedulerLoopHandle = usize;

pub struct SchedulerState {
    pub start_time: f64,
    pub interval_handle: SchedulerLoopHandle,
    pub cursor_animation_frame_handle: SchedulerLoopHandle,
    pub end_time_of_last_scheduling_period: f64,
    pub total_previously_scheduled_beats: f64,
    pub state: &'static mut MIDIEditorGridHandler,
    pub grid_state: &'static mut GridState<usize>,
    pub cb: Closure<(dyn std::ops::FnMut(f64) + 'static)>,
    pub cursor_animation_cb: Closure<dyn std::ops::FnMut(f64) + 'static>,
}

impl SchedulerState {
    pub fn get_cur_cursor_pos_beats(&self, cur_time: f64) -> f64 {
        let start_mark_pos_beats: f64 = self
            .state
            .loop_start_mark_measure
            .as_ref()
            .map(|descriptor| descriptor.measure as f64)
            .unwrap_or(0.);
        let end_mark_pos_beats = match self.state.loop_end_mark_measure {
            Some(LoopMarkDescriptor { measure, .. }) => measure as f64,
            None => panic!(
                "Tried to schedule a loop cursor animation without a loop end mark being set"
            ),
        };
        let loop_length_beats = end_mark_pos_beats - start_mark_pos_beats;

        let time_since_start = cur_time - self.start_time;
        let beats_since_start = self.state.time_to_beats(time_since_start);
        let loops_since_start = beats_since_start / loop_length_beats;
        let cur_loop_percentage_finished = loops_since_start.fract();
        let cur_loop_beats_from_start = cur_loop_percentage_finished * loop_length_beats;
        start_mark_pos_beats + cur_loop_beats_from_start
    }
}

const RESCHEDULE_INTERVAL_MS: usize = 2222;

pub fn run_midi_editor_loop_scheduler(scheduler_state_handle: SchedulerStateHandle, cur_time: f64) {
    let mut scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };
    run_scheduler(&mut scheduler_state, cur_time);
    std::mem::forget(scheduler_state);
}

fn init_scheduler_interval(scheduler_state: SchedulerState) -> SchedulerStateHandle {
    let state_handle: SchedulerStateHandle = Box::into_raw(box scheduler_state);
    let cb = Closure::wrap(
        (box move |cur_time: f64| run_midi_editor_loop_scheduler(state_handle, cur_time))
            as Box<dyn FnMut(f64)>,
    );
    let interval_handle = js::register_midi_editor_loop_interval(&cb, RESCHEDULE_INTERVAL_MS);
    unsafe {
        (*state_handle).interval_handle = interval_handle;
        (*state_handle).cb = cb;
    };
    state_handle
}

fn animate_cursor(scheduler_state_handle: SchedulerStateHandle, cur_time: f64) {
    let scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };

    let cursor_pos_beats = scheduler_state.get_cur_cursor_pos_beats(cur_time);
    let cursor_pos_px = scheduler_state
        .grid_state
        .conf
        .beats_to_px(cursor_pos_beats as f32);

    scheduler_state.grid_state.cursor_pos_beats = cursor_pos_beats as f32;
    MidiEditorGridRenderer::set_cursor_pos(scheduler_state.grid_state.cursor_dom_id, cursor_pos_px);

    std::mem::forget(scheduler_state);
}

fn init_cursor_animation_interval(scheduler_state_handle: SchedulerStateHandle) {
    let mut scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };
    let cb = Closure::wrap(
        (box (move |cur_time: f64| animate_cursor(scheduler_state_handle, cur_time)))
            as Box<dyn FnMut(f64)>,
    );
    let animation_frame_handle = js::midi_editor_register_animation_frame(&cb);
    scheduler_state.cursor_animation_frame_handle = animation_frame_handle;
    scheduler_state.cursor_animation_cb = cb;
    std::mem::forget(scheduler_state);
}

pub fn cancel_loop(scheduler_state_handle: SchedulerStateHandle, stop_playing_notes: bool) {
    let scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };
    js::cancel_midi_editor_loop_interval(scheduler_state.interval_handle);
    js::midi_editor_cancel_animation_frame(scheduler_state.cursor_animation_frame_handle);
    js::midi_editor_cancel_all_events(&scheduler_state.state.vc_id, stop_playing_notes);
    drop(scheduler_state);
}

pub fn init_scheduler_loop(
    start_time: f64,
    cursor_pos_beats: f64,
    state: &mut MIDIEditorGridHandler,
    grid_state: &mut GridState<usize>,
) -> Option<SchedulerStateHandle> {
    let end_mark_pos = match state
        .loop_end_mark_measure
        .as_ref()
        .map(|descriptor| descriptor.measure as f64)
    {
        Some(pos) => pos,
        None => {
            error!("Tried to schedule loop without having a loop end position set");
            return None;
        },
    };
    let start_mark_pos = state
        .loop_start_mark_measure
        .as_ref()
        .map(|descriptor| descriptor.measure as f64)
        .unwrap_or(0.0);
    let start_beat = if cursor_pos_beats > end_mark_pos || cursor_pos_beats < start_mark_pos {
        start_mark_pos
    } else {
        cursor_pos_beats
    };

    // Pretend we've already scheduled up to the start cursor offset
    let beats_to_skip = start_beat - start_mark_pos;
    let time_to_skip = state.beats_to_seconds(beats_to_skip);

    let scheduler_state = SchedulerState {
        cb: Closure::new(box |_: f64| {}),
        cursor_animation_cb: Closure::new(box |_: f64| {}),
        start_time,
        interval_handle: 0,
        cursor_animation_frame_handle: 0,
        end_time_of_last_scheduling_period: start_time + time_to_skip,
        total_previously_scheduled_beats: beats_to_skip,
        state: unsafe { std::mem::transmute(state) },
        grid_state: unsafe { std::mem::transmute(grid_state) },
    };
    let handle = init_scheduler_interval(scheduler_state);
    init_cursor_animation_interval(handle);
    // Schedule once immediately
    run_midi_editor_loop_scheduler(handle, start_time);
    Some(handle)
}

/// Clears all pending events and re-schedules starting at the current time
pub fn reschedule(cur_time: f64, scheduler_state_handle: SchedulerStateHandle) {
    let scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };

    // Find where the cursor is the instant that we're rescheduling
    let cur_cursor_pos_beats = scheduler_state.get_cur_cursor_pos_beats(cur_time);

    // Delightfully unsafe
    let grid_state: &'static mut GridState<usize> =
        unsafe { std::mem::transmute(scheduler_state.grid_state as *mut _) };
    let state: &'static mut MIDIEditorGridHandler =
        unsafe { std::mem::transmute(scheduler_state.state as *mut _) };
    std::mem::forget(scheduler_state);

    // Cancel the current scheduler and initialize a new one, freshly updated with the current state
    cancel_loop(scheduler_state_handle, false);
    let new_loop_handle = init_scheduler_loop(cur_time, cur_cursor_pos_beats, state, grid_state);
    state.loop_handle = new_loop_handle;
}

fn run_scheduler(scheduler_state: &mut SchedulerState, cur_time: f64) {
    debug!("SCHED ENTER");
    let start_mark_pos_beats: f64 = scheduler_state
        .state
        .loop_start_mark_measure
        .as_ref()
        .map(|descriptor| descriptor.measure as f64)
        .unwrap_or(0.);
    let cur_sched_period_start_time = scheduler_state.end_time_of_last_scheduling_period;
    let end_mark_pos_beats = match scheduler_state.state.loop_end_mark_measure {
        Some(LoopMarkDescriptor { measure, .. }) => measure as f64,
        None => {
            error!("Tried to schedule a loop without a loop end mark being set");
            return;
        },
    };
    let loop_length_beats = end_mark_pos_beats - start_mark_pos_beats;
    let loop_length_seconds = scheduler_state.state.beats_to_seconds(loop_length_beats);
    let total_previously_scheduled_full_loops =
        (scheduler_state.total_previously_scheduled_beats / loop_length_beats).trunc();

    // Schedule a leeway of 3 secheduling periods ahead of the current time
    let end_time_of_cur_sched_window = cur_time + ((RESCHEDULE_INTERVAL_MS * 3) as f64 / 1000.);
    let cur_sched_period_length_seconds =
        end_time_of_cur_sched_window - cur_sched_period_start_time;
    let cur_sched_period_length_beats = scheduler_state
        .state
        .time_to_beats(cur_sched_period_length_seconds);
    let beats_to_schedule = cur_sched_period_length_beats;
    debug!("beats_to_schedule: {}", beats_to_schedule);

    // Schedule the loop repeatedly at increasing offsets until all necessary beats have been
    // covered
    let mut is_attack_flags: Vec<u8> = Vec::new();
    let mut note_ids: Vec<usize> = Vec::new();
    let mut event_timings: Vec<f64> = Vec::new();

    let beats_from_start_of_cur_loop =
        scheduler_state.total_previously_scheduled_beats % loop_length_beats;
    let relative_start_beat = start_mark_pos_beats + beats_from_start_of_cur_loop;
    let beats_remaining_in_cur_loop = loop_length_beats - beats_from_start_of_cur_loop;

    let relative_end_beat = if beats_to_schedule < beats_remaining_in_cur_loop {
        relative_start_beat + beats_to_schedule
    } else {
        relative_start_beat + beats_remaining_in_cur_loop
    };

    debug!(
        "Scheduling from relative beats {} to {}",
        relative_start_beat, relative_end_beat
    );
    let events = scheduler_state
        .grid_state
        .data
        .iter_events(None)
        .skip_while(|event| event.beat < (relative_start_beat as f32))
        .take_while(|event| event.beat <= (relative_end_beat as f32));

    for event in events {
        let note_id = scheduler_state.grid_state.conf.row_count - event.line_ix;
        note_ids.push(note_id);
        is_attack_flags.push(tern(event.is_start, 1, 0));
        let event_time_seconds = scheduler_state.start_time
            + (total_previously_scheduled_full_loops * loop_length_seconds)
            + scheduler_state.state.beats_to_seconds(event.beat as f64);
        event_timings.push(event_time_seconds);
    }
    js::midi_editor_schedule_events(
        &scheduler_state.state.vc_id,
        &is_attack_flags,
        &note_ids,
        &event_timings,
    );

    let scheduled_beats = relative_end_beat - relative_start_beat;
    scheduler_state.total_previously_scheduled_beats += scheduled_beats;
    debug!(
        "scheduled_beats: {}, total_previously_scheduled_beats: {}",
        scheduled_beats, scheduler_state.total_previously_scheduled_beats
    );
    // We finished scheduling a full loop, but we still have more beats to schedule.  Queue up
    // another (potentially partial) loop to be scheduled
    if scheduled_beats < beats_to_schedule {
        scheduler_state.end_time_of_last_scheduling_period +=
            scheduler_state.state.beats_to_seconds(scheduled_beats);
        debug!(
            "Need to schedule another (potentially partial) loop; \
             end_time_of_last_scheduling_period: {}",
            scheduler_state.end_time_of_last_scheduling_period
        );
        return run_scheduler(scheduler_state, cur_time);
    }

    scheduler_state.end_time_of_last_scheduling_period = end_time_of_cur_sched_window;
    debug!(
        "SCHED EXIT; scheduled through time {}",
        end_time_of_cur_sched_window
    );
}
