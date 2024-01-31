use std::cmp::Reverse;

use common::ref_static_mut;
use float_ord::FloatOrd;
use heapless::binary_heap::{BinaryHeap, Min};

extern "C" {
  fn run_callback(cb_id: i32);

  fn run_midi_callback(mailbox_ix: usize, event_type: u8, param_0: f32, param_1: f32);

  #[allow(dead_code)]
  fn debug1(v: i32);
}

#[derive(Clone, PartialEq)]
struct MidiEvent {
  pub mailbox_ix: usize,
  pub param_0: f32,
  pub param_1: f32,
  pub event_type: u8,
}

#[derive(Clone, PartialEq)]
struct ScheduledEvent {
  pub time: f64,
  pub cb_id: i32,
  pub midi_evt: Option<MidiEvent>,
}

impl Eq for ScheduledEvent {}

impl Ord for ScheduledEvent {
  fn cmp(&self, other: &Self) -> std::cmp::Ordering {
    // when sending MIDI events, we always need to make sure to send release events before
    // attack events.  This will prevent MIDI event consumers from getting into a bad state due
    // to multiple attacks for the same note etc.
    let this = (
      FloatOrd(self.time),
      self.midi_evt.as_ref().map(|m| Reverse(m.event_type)),
    );
    let other = (
      FloatOrd(other.time),
      other.midi_evt.as_ref().map(|m| Reverse(m.event_type)),
    );

    this.cmp(&other)
  }
}

impl PartialOrd for ScheduledEvent {
  fn partial_cmp(&self, other: &ScheduledEvent) -> Option<std::cmp::Ordering> {
    Some(self.cmp(other))
  }
}

static mut SCHEDULED_EVENTS: BinaryHeap<ScheduledEvent, Min, 1048576> = BinaryHeap::new();
static mut SCHEDULED_BEAT_EVENTS: BinaryHeap<ScheduledEvent, Min, 1048576> = BinaryHeap::new();

#[no_mangle]
pub unsafe extern "C" fn stop() {
  SCHEDULED_EVENTS.clear();
  SCHEDULED_BEAT_EVENTS.clear();
}

#[no_mangle]
pub extern "C" fn schedule(time: f64, cb_id: i32) {
  if cb_id == 0 {
    panic!();
  }

  unsafe {
    SCHEDULED_EVENTS.push_unchecked(ScheduledEvent {
      time,
      cb_id,
      midi_evt: None,
    })
  }
}

#[no_mangle]
pub extern "C" fn schedule_beats(
  beats: f64,
  cb_id: i32,
  mailbox_ix: i32,
  midi_event_type: u8,
  midi_param_0: f32,
  midi_param_1: f32,
) {
  if cb_id == 0 {
    panic!();
  }

  let midi_evt = if mailbox_ix >= 0 {
    Some(MidiEvent {
      mailbox_ix: mailbox_ix as usize,
      event_type: midi_event_type,
      param_0: midi_param_0,
      param_1: midi_param_1,
    })
  } else {
    None
  };

  unsafe {
    SCHEDULED_BEAT_EVENTS.push_unchecked(ScheduledEvent {
      time: beats,
      cb_id,
      midi_evt,
    })
  }
}

fn handle_event(evt: ScheduledEvent) {
  if let Some(midi_evt) = evt.midi_evt {
    unsafe {
      run_midi_callback(
        midi_evt.mailbox_ix,
        midi_evt.event_type,
        midi_evt.param_0,
        midi_evt.param_1,
      )
    }
  } else {
    unsafe { run_callback(evt.cb_id) }
  }
}

#[no_mangle]
pub extern "C" fn run(raw_cur_time: f64, cur_beats: f64) {
  let scheduled_events = ref_static_mut!(SCHEDULED_EVENTS);
  loop {
    match scheduled_events.peek() {
      None => break,
      Some(evt) if evt.time > raw_cur_time => break,
      _ => (),
    }

    let evt = unsafe { scheduled_events.pop_unchecked() };
    handle_event(evt);
  }

  let scheduled_beat_events = ref_static_mut!(SCHEDULED_BEAT_EVENTS);
  loop {
    match scheduled_beat_events.peek() {
      None => break,
      Some(evt) if evt.time > cur_beats => break,
      _ => (),
    }

    let evt = unsafe { scheduled_beat_events.pop_unchecked() };
    handle_event(evt);
  }
}

static mut IDS_BUFFER: *mut Vec<i32> = std::ptr::null_mut();

#[no_mangle]
pub unsafe extern "C" fn alloc_ids_buffer(count: usize) -> *mut i32 {
  if !IDS_BUFFER.is_null() {
    let ids_buf = &mut *IDS_BUFFER;
    ids_buf.resize(count, 0);
    return ids_buf.as_mut_ptr();
  }

  let mut new_buf = vec![0; count];
  let ptr = new_buf.as_mut_ptr();
  IDS_BUFFER = Box::into_raw(Box::new(new_buf));

  ptr
}

#[no_mangle]
pub extern "C" fn cancel_events_by_ids() -> usize {
  let ids = unsafe { &*IDS_BUFFER }.as_slice();
  let scheduled_events = ref_static_mut!(SCHEDULED_EVENTS);
  let scheduled_beat_events = ref_static_mut!(SCHEDULED_BEAT_EVENTS);

  let mut actually_cancelled_evt_count = 0;

  let new_scheduled_events = scheduled_events
    .iter()
    .filter(|evt| {
      let should_remove = ids.contains(&evt.cb_id);
      if should_remove {
        actually_cancelled_evt_count += 1;
      }
      !should_remove
    })
    .cloned()
    .collect::<Vec<_>>();
  scheduled_events.clear();
  for evt in new_scheduled_events {
    unsafe { scheduled_events.push_unchecked(evt) }
  }

  let new_scheduled_beat_events = scheduled_beat_events
    .iter()
    .filter(|evt| {
      let should_remove = ids.contains(&evt.cb_id);
      if should_remove {
        actually_cancelled_evt_count += 1;
      }
      !should_remove
    })
    .cloned()
    .collect::<Vec<_>>();
  scheduled_beat_events.clear();
  for evt in new_scheduled_beat_events {
    unsafe { scheduled_beat_events.push_unchecked(evt) }
  }

  actually_cancelled_evt_count
}
