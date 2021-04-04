use float_ord::FloatOrd;
use heapless::{
    binary_heap::{BinaryHeap, Min},
    consts::U1048576,
};

extern "C" {
    fn run_callback(cb_id: i32);
}

#[derive(PartialEq)]
struct ScheduledEvent {
    pub time: f64,
    pub cb_id: i32,
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

static mut IS_STARTED: bool = false;
static mut START_TIME: f64 = 0.;
static mut SCHEDULED_EVENTS: BinaryHeap<ScheduledEvent, U1048576, Min> =
    BinaryHeap(heapless::i::BinaryHeap::new());
static mut SCHEDULED_BEAT_EVENTS: BinaryHeap<ScheduledEvent, U1048576, Min> =
    BinaryHeap(heapless::i::BinaryHeap::new());

#[no_mangle]
pub unsafe extern "C" fn start(time: f64) {
    IS_STARTED = true;
    START_TIME = time;
}

#[no_mangle]
pub unsafe extern "C" fn stop() { IS_STARTED = false; }

#[no_mangle]
pub extern "C" fn schedule(time: f64, cb_id: i32) {
    unsafe { SCHEDULED_EVENTS.push_unchecked(ScheduledEvent { time, cb_id }) }
}

#[no_mangle]
pub extern "C" fn schedule_beats(beats: f64, cb_id: i32) {
    unsafe { SCHEDULED_BEAT_EVENTS.push_unchecked(ScheduledEvent { time: beats, cb_id }) }
}

#[no_mangle]
pub extern "C" fn run(raw_cur_time: f64, cur_beats: f64) {
    // Normalize `cur_time` to be relative to the time at which the counter was started
    let cur_time = raw_cur_time - unsafe { START_TIME };

    let scheduled_events = unsafe { &mut SCHEDULED_EVENTS };
    loop {
        match scheduled_events.peek() {
            None => break,
            Some(evt) if evt.time > cur_time => break,
            _ => (),
        }

        let evt = unsafe { scheduled_events.pop_unchecked() };
        unsafe { run_callback(evt.cb_id) };
    }

    let scheduled_beat_events = unsafe { &mut SCHEDULED_BEAT_EVENTS };
    loop {
        match scheduled_beat_events.peek() {
            None => break,
            Some(evt) if evt.time > cur_beats => break,
            _ => (),
        }

        let evt = unsafe { scheduled_beat_events.pop_unchecked() };
        unsafe { run_callback(evt.cb_id) };
    }
}
