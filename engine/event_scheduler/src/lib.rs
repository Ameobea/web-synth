use std::cmp::Reverse;

use common::ref_static_mut;
use float_ord::FloatOrd;
use heapless::binary_heap::{BinaryHeap, Min};

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
  fn run_callback(cb_id: i32);

  fn run_midi_callback(mailbox_ix: usize, event_type: u8, param_0: f32, param_1: f32);

  #[allow(dead_code)]
  fn debug1(v: i32);
}

#[cfg(not(target_arch = "wasm32"))]
extern "C" fn run_callback(_cb_id: i32) { unimplemented!() }

#[cfg(not(target_arch = "wasm32"))]
extern "C" fn run_midi_callback(_mailbox_ix: usize, _event_type: u8, _param_0: f32, _param_1: f32) {
  unimplemented!()
}

#[cfg(not(target_arch = "wasm32"))]
extern "C" fn debug1(_v: i32) {}

#[derive(Clone, PartialEq, Debug)]
struct MidiEvent {
  pub mailbox_ix: usize,
  pub param_0: f32,
  pub param_1: f32,
  pub event_type: u8,
}

#[derive(Clone, PartialEq, Debug)]
struct ScheduledEvent {
  pub time: f64,
  pub cb_id: i32,
  pub midi_evt: Option<MidiEvent>,
  /// MIDI event type of the event the callback will fire, when known; only used for ordering
  pub event_type_hint: Option<u8>,
}

impl Eq for ScheduledEvent {}

impl Ord for ScheduledEvent {
  fn cmp(&self, other: &Self) -> std::cmp::Ordering {
    // when sending MIDI events, we always need to make sure to send release events before
    // attack events.  This will prevent MIDI event consumers from getting into a bad state due
    // to multiple attacks for the same note etc.
    let this = (FloatOrd(self.time), self.event_type_hint.map(Reverse));
    let other = (FloatOrd(other.time), other.event_type_hint.map(Reverse));

    this.cmp(&other)
  }
}

impl PartialOrd for ScheduledEvent {
  fn partial_cmp(&self, other: &ScheduledEvent) -> Option<std::cmp::Ordering> {
    Some(self.cmp(other))
  }
}

const HEAP_CAPACITY: usize = 65536;

static mut SCHEDULED_EVENTS: BinaryHeap<ScheduledEvent, Min, HEAP_CAPACITY> = BinaryHeap::new();
static mut SCHEDULED_BEAT_EVENTS: BinaryHeap<ScheduledEvent, Min, HEAP_CAPACITY> =
  BinaryHeap::new();

fn scheduled_events() -> &'static mut BinaryHeap<ScheduledEvent, Min, HEAP_CAPACITY> {
  ref_static_mut!(SCHEDULED_EVENTS)
}

fn scheduled_beat_events() -> &'static mut BinaryHeap<ScheduledEvent, Min, HEAP_CAPACITY> {
  ref_static_mut!(SCHEDULED_BEAT_EVENTS)
}

#[no_mangle]
pub unsafe extern "C" fn stop() {
  scheduled_events().clear();
  scheduled_beat_events().clear();
}

#[no_mangle]
pub extern "C" fn schedule(time: f64, cb_id: i32) {
  if cb_id == 0 {
    panic!();
  }

  scheduled_events()
    .push(ScheduledEvent {
      time,
      cb_id,
      midi_evt: None,
      event_type_hint: None,
    })
    .expect("`SCHEDULED_EVENTS` is full");
}

#[no_mangle]
pub extern "C" fn schedule_beats(
  beats: f64,
  cb_id: i32,
  mailbox_ix: i32,
  midi_event_type: i32,
  midi_param_0: f32,
  midi_param_1: f32,
) {
  if cb_id == 0 {
    panic!();
  }

  let midi_evt = if mailbox_ix >= 0 {
    Some(MidiEvent {
      mailbox_ix: mailbox_ix as usize,
      event_type: midi_event_type as u8,
      param_0: midi_param_0,
      param_1: midi_param_1,
    })
  } else {
    None
  };

  scheduled_beat_events()
    .push(ScheduledEvent {
      time: beats,
      cb_id,
      midi_evt,
      event_type_hint: (midi_event_type >= 0).then(|| midi_event_type as u8),
    })
    .expect("`SCHEDULED_BEAT_EVENTS` is full");
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
  loop {
    match scheduled_events().peek() {
      None => break,
      Some(evt) if evt.time > raw_cur_time => break,
      _ => (),
    }

    let evt = unsafe { scheduled_events().pop_unchecked() };
    handle_event(evt);
  }

  loop {
    match scheduled_beat_events().peek() {
      None => break,
      Some(evt) if evt.time > cur_beats => break,
      _ => (),
    }

    let evt = unsafe { scheduled_beat_events().pop_unchecked() };
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

  let mut actually_cancelled_evt_count = 0;

  let new_scheduled_events = scheduled_events()
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
  scheduled_events().clear();
  for evt in new_scheduled_events {
    scheduled_events()
      .push(evt)
      .expect("`SCHEDULED_EVENTS` is full")
  }

  let new_scheduled_beat_events = scheduled_beat_events()
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
  scheduled_beat_events().clear();
  for evt in new_scheduled_beat_events {
    scheduled_beat_events()
      .push(evt)
      .expect("`SCHEDULED_BEAT_EVENTS` is full")
  }

  actually_cancelled_evt_count
}
