use float_ord::FloatOrd;
use heapless::binary_heap::{BinaryHeap, Min};

extern "C" {
    fn run_callback(cb_id: i32);

    fn run_midi_callback(mailbox_ix: usize, event_type: u8, param_0: f32, param_1: f32);
}

#[derive(PartialEq)]
struct MidiEvent {
    pub mailbox_ix: usize,
    pub event_type: u8,
    pub param_0: f32,
    pub param_1: f32,
}

#[derive(PartialEq)]
struct ScheduledEvent {
    pub time: f64,
    pub cb_id: i32,
    pub midi_evt: Option<MidiEvent>,
}

impl Eq for ScheduledEvent {}

impl Ord for ScheduledEvent {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        FloatOrd(self.time).cmp(&FloatOrd(other.time))
    }
}

impl PartialOrd for ScheduledEvent {
    fn partial_cmp(&self, other: &ScheduledEvent) -> Option<std::cmp::Ordering> {
        Some(FloatOrd(self.time).cmp(&FloatOrd(other.time)))
    }
}

static mut SCHEDULED_EVENTS: BinaryHeap<ScheduledEvent, Min, 1048576> = BinaryHeap::new();
static mut SCHEDULED_BEAT_EVENTS: BinaryHeap<ScheduledEvent, Min, 1048576> = BinaryHeap::new();

#[no_mangle]
pub unsafe extern "C" fn stop() { SCHEDULED_EVENTS.clear(); }

#[no_mangle]
pub extern "C" fn schedule(time: f64, cb_id: i32) {
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
    let scheduled_events = unsafe { &mut SCHEDULED_EVENTS };
    loop {
        match scheduled_events.peek() {
            None => break,
            Some(evt) if evt.time > raw_cur_time => break,
            _ => (),
        }

        let evt = unsafe { scheduled_events.pop_unchecked() };
        handle_event(evt);
    }

    let scheduled_beat_events = unsafe { &mut SCHEDULED_BEAT_EVENTS };
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
