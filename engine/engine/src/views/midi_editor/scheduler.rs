//! Scheduler for notes of the MIDI editor.  Allows for a composition to be played through or for
//! part of it to be looped continuously.

use super::{LoopMarkDescriptor, MIDIEditorGridHandler, MidiEditorGridRenderer};
use crate::helpers::grid::prelude::*;

pub type SchedulerStateHandle = *mut SchedulerState;
pub type SchedulerLoopHandle = usize;

pub struct SchedulerState {
    pub start_time: f32,
    pub interval_handle: SchedulerLoopHandle,
    pub cursor_animation_frame_handle: SchedulerLoopHandle,
    pub end_beat_of_last_scheduling_period: f32,
    pub start_beat_offset_from_start_cursor: f32,
    pub state: &'static mut MIDIEditorGridHandler,
    pub grid_state: &'static mut GridState<usize>,
    pub cb: Closure<(dyn std::ops::FnMut(f32) + 'static)>,
    pub cursor_animation_cb: Closure<dyn std::ops::FnMut(f32) + 'static>,
}

const RESCHEDULE_INTERVAL_MS: usize = 500;

pub fn run_midi_editor_loop_scheduler(scheduler_state_handle: SchedulerStateHandle, cur_time: f32) {
    let mut scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };
    run_scheduler(&mut scheduler_state, cur_time);
    std::mem::forget(scheduler_state);
}

fn init_scheduler_interval(scheduler_state: SchedulerState) -> SchedulerStateHandle {
    let state_handle: SchedulerStateHandle = Box::into_raw(Box::new(scheduler_state));
    let cb = Closure::wrap(Box::new(move |cur_time: f32| {
        run_midi_editor_loop_scheduler(state_handle, cur_time)
    }) as Box<dyn FnMut(f32)>);
    let interval_handle = js::register_midi_editor_loop_interval(&cb, RESCHEDULE_INTERVAL_MS);
    unsafe {
        (*state_handle).interval_handle = interval_handle;
        (*state_handle).cb = cb;
    };
    state_handle
}

fn animate_cursor(scheduler_state_handle: SchedulerStateHandle, cur_time: f32) {
    let scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };

    let start_mark_pos_beats: f32 = scheduler_state
        .state
        .loop_start_mark_measure
        .as_ref()
        .map(|descriptor| descriptor.measure as f32)
        .unwrap_or(0.);
    let end_mark_pos_beats = match scheduler_state.state.loop_end_mark_measure {
        Some(LoopMarkDescriptor { measure, .. }) => measure as f32,
        None => {
            error!("Tried to schedule a loop cursor animation without a loop end mark being set");
            return;
        },
    };
    let loop_length_beats = end_mark_pos_beats - start_mark_pos_beats;

    let time_since_start = cur_time - scheduler_state.start_time;
    let beats_since_start = scheduler_state.state.time_to_beats(time_since_start);
    let loops_since_start = (beats_since_start
        + scheduler_state.start_beat_offset_from_start_cursor)
        / loop_length_beats;
    let cur_loop_percentage_finished = loops_since_start % loop_length_beats;
    let cur_loop_beats_from_start = cur_loop_percentage_finished * loop_length_beats;
    let cursor_pos_beats = start_mark_pos_beats + cur_loop_beats_from_start;

    let intervals = cursor_pos_beats / scheduler_state.grid_state.conf.note_snap_beat_interval;
    let snapped_x_px = scheduler_state
        .grid_state
        .conf
        .beats_to_px(intervals * scheduler_state.grid_state.conf.note_snap_beat_interval);
    scheduler_state.grid_state.cursor_pos_beats =
        scheduler_state.grid_state.conf.px_to_beat(snapped_x_px);
    MidiEditorGridRenderer::set_cursor_pos(scheduler_state.grid_state.cursor_dom_id, snapped_x_px);

    std::mem::forget(scheduler_state);
}

fn init_cursor_animation_interval(scheduler_state_handle: SchedulerStateHandle) {
    let mut scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };
    let cb = Closure::wrap(Box::new(move |cur_time: f32| {
        animate_cursor(scheduler_state_handle, cur_time)
    }) as Box<dyn FnMut(f32)>);
    let animation_frame_handle = js::midi_editor_register_animation_frame(&cb);
    scheduler_state.cursor_animation_frame_handle = animation_frame_handle;
    std::mem::forget(scheduler_state);
}

pub fn cancel_loop(scheduler_state_handle: SchedulerStateHandle) {
    let scheduler_state = unsafe { Box::from_raw(scheduler_state_handle) };
    js::cancel_midi_editor_loop_interval(scheduler_state.interval_handle);
    js::midi_editor_cancel_animation_frame(scheduler_state.cursor_animation_frame_handle);
    js::midi_editor_cancel_all_events(&scheduler_state.state.vc_id);
    drop(scheduler_state);
}

pub fn init_scheduler_loop(
    start_time: f32,
    cursor_pos_beats: f32,
    state: &mut MIDIEditorGridHandler,
    grid_state: &mut GridState<usize>,
) -> Option<SchedulerStateHandle> {
    let end_mark_pos = match state
        .loop_end_mark_measure
        .as_ref()
        .map(|descriptor| descriptor.measure as f32)
    {
        Some(pos) => pos,
        None => {
            error!("Tried to schedule loop without having a loop end position set");
            return None;
        },
    };
    let start_cursor_pos_beats = state
        .loop_start_mark_measure
        .as_ref()
        .map(|descriptor| descriptor.measure as f32)
        .unwrap_or(0.0);
    let start_beat = if cursor_pos_beats > end_mark_pos {
        start_cursor_pos_beats
    } else {
        cursor_pos_beats
    };
    let scheduler_state = SchedulerState {
        cb: Closure::new(box |_: f32| {}),
        cursor_animation_cb: Closure::new(box |_: f32| {}),
        start_time,
        interval_handle: 0,
        cursor_animation_frame_handle: 0,
        start_beat_offset_from_start_cursor: start_beat - start_cursor_pos_beats,
        end_beat_of_last_scheduling_period: start_beat,
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
pub fn reschedule(cur_time: f32, handle: SchedulerStateHandle) {
    unimplemented!() // TODO
}

fn run_scheduler(scheduler_state: &mut SchedulerState, cur_time: f32) {
    let start_mark_pos_beats: f32 = scheduler_state
        .state
        .loop_start_mark_measure
        .as_ref()
        .map(|descriptor| descriptor.measure as f32)
        .unwrap_or(0.);
    let mut absolute_start_time = scheduler_state.end_beat_of_last_scheduling_period;
    let end_mark_pos_beats = match scheduler_state.state.loop_end_mark_measure {
        Some(LoopMarkDescriptor { measure, .. }) => measure as f32,
        None => {
            warn!("Tried to schedule a loop without a loop end mark being set");
            return;
        },
    };
    let loop_length_beats = end_mark_pos_beats - start_mark_pos_beats;
    info!(
        "start_mark_pos_beats: {}, end_mark_pos_beats: {}, loop_length_beats: {}",
        start_mark_pos_beats, end_mark_pos_beats, loop_length_beats
    );
    let mut relative_start_time = absolute_start_time % loop_length_beats;
    let absolute_end_time = ((absolute_start_time - relative_start_time) + end_mark_pos_beats)
        .min(cur_time + ((RESCHEDULE_INTERVAL_MS * 3) as f32));

    let beats_per_second = scheduler_state.state.bpm / 60.;
    let seconds_to_schedule = (RESCHEDULE_INTERVAL_MS as f32) / 1000.;
    let beats_to_schedule = beats_per_second * seconds_to_schedule;

    // Schedule the loop repeatedly at increasing offsets until all necessary beats have been
    // covered
    let mut total_scheduled_beats = 0.0;
    let mut is_attack_flags: Vec<u8> = Vec::new();
    let mut note_ids: Vec<usize> = Vec::new();
    let mut event_timings: Vec<f32> = Vec::new();
    while total_scheduled_beats < beats_to_schedule {
        let relative_end_time = if absolute_end_time - absolute_start_time > loop_length_beats {
            end_mark_pos_beats
        } else {
            relative_start_time + (absolute_end_time - absolute_start_time)
        };
        info!(
            "absolute_start_time: {}, relative_start_time: {}, absolute_end_time: {}, \
             relative_end_time: {}",
            absolute_start_time, relative_start_time, absolute_end_time, relative_end_time
        );
        let offset = absolute_start_time - relative_start_time;
        let events = scheduler_state
            .grid_state
            .data
            .iter_events(Some(relative_start_time))
            .filter(|event| !(event.is_start && event.beat >= relative_end_time));

        for event in events {
            let note_id = scheduler_state.grid_state.conf.row_count - event.line_ix;
            note_ids.push(note_id);
            is_attack_flags.push(tern(event.is_start, 1, 0));
            let event_time_seconds =
                (((offset + event.beat) / scheduler_state.state.bpm) * 60.0) / 4.0;
            event_timings.push(event_time_seconds);
        }
        js::midi_editor_schedule_events(
            &scheduler_state.state.vc_id,
            &is_attack_flags,
            &note_ids,
            &event_timings,
        );

        let scheduled_beats = relative_end_time - relative_start_time;
        total_scheduled_beats += scheduled_beats;
        relative_start_time = start_mark_pos_beats;
        // We will always have markers at even measures, and this prevents any floating-point issues
        absolute_start_time = (absolute_start_time + scheduled_beats).round();
    }

    scheduler_state.end_beat_of_last_scheduling_period += total_scheduled_beats;
}
