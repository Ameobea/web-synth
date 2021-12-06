#![feature(box_syntax)]

use float_ord::FloatOrd;

extern "C" {
    fn play_note(note: u8);

    fn release_note(note: u8);
}

#[derive(Debug, Clone, PartialEq)]
struct MIDIEvent {
    pub is_gate: bool,
    pub note: u8,
    pub beat: f32,
}

impl Eq for MIDIEvent {}

impl Ord for MIDIEvent {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        FloatOrd(self.beat).cmp(&FloatOrd(other.beat))
    }
}

impl PartialOrd for MIDIEvent {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(FloatOrd(self.beat).cmp(&FloatOrd(other.beat)))
    }
}

struct LooperCtx {
    pub loop_len_beats: f32,
    pub last_beat: f32,
    pub next_evt_ix: Option<usize>,
    pub active_bank_ix: usize,
    /// Index of the bank to switch to when the current loop finishes
    pub next_bank_ix: Option<usize>,
}

static mut CTX: LooperCtx = LooperCtx {
    loop_len_beats: 8.,
    last_beat: 0.0,
    next_evt_ix: None,
    active_bank_ix: 0,
    next_bank_ix: None,
};

static mut PLAYING_NOTES: [bool; 1024] = [false; 1024];

fn playing_notes() -> &'static mut [bool] { unsafe { &mut PLAYING_NOTES } }

fn ctx() -> &'static mut LooperCtx { unsafe { &mut CTX } }

const BANK_COUNT: usize = 128;

#[no_mangle]
pub extern "C" fn looper_set_loop_len_beats(len_beats: f32) { ctx().loop_len_beats = len_beats; }

static mut MIDI_BANKS: *mut [Vec<MIDIEvent>; BANK_COUNT] = std::ptr::null_mut();

fn midi_banks() -> &'static mut [Vec<MIDIEvent>; BANK_COUNT] { unsafe { &mut *MIDI_BANKS } }

#[inline(always)]
fn uninit<T>() -> T { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }

#[no_mangle]
pub extern "C" fn looper_init() {
    unsafe {
        MIDI_BANKS = Box::into_raw(box uninit());
        for i in 0..BANK_COUNT {
            std::ptr::write((*MIDI_BANKS).as_mut_ptr().add(i), Vec::new());
        }
    }
}

#[no_mangle]
pub extern "C" fn looper_clear_bank(bank_ix: usize) {
    let bank = &mut midi_banks()[bank_ix];
    bank.clear();
}

#[no_mangle]
pub extern "C" fn looper_add_evt(bank_ix: usize, note: u8, beat: f32, is_gate: bool) {
    let bank = &mut midi_banks()[bank_ix];
    bank.push(MIDIEvent {
        note,
        beat,
        is_gate,
    });
}

#[no_mangle]
pub extern "C" fn looper_finalize_bank(bank_ix: usize) {
    let bank = &mut midi_banks()[bank_ix];
    bank.sort_unstable();
}

/// Switch immediately to the next bank, skipping ahead in the new one to match the current beat
#[no_mangle]
pub extern "C" fn looper_activate_bank(bank_ix: usize, cur_beat: f32) {
    let ctx = ctx();
    let bank = &mut midi_banks()[bank_ix];
    let loop_beat = cur_beat % ctx.loop_len_beats;

    ctx.last_beat = loop_beat;
    ctx.active_bank_ix = bank_ix;
    ctx.next_evt_ix = if bank.is_empty() { None } else { Some(0) };
    while let Some(next_evt_ix) = ctx.next_evt_ix {
        let evt = &bank[next_evt_ix];
        if evt.beat > loop_beat {
            break;
        }
        ctx.next_evt_ix = if next_evt_ix + 1 < bank.len() {
            Some(next_evt_ix + 1)
        } else {
            None
        };
    }
}

#[no_mangle]
pub extern "C" fn looper_set_next_bank_ix(bank_ix: usize) { ctx().next_bank_ix = Some(bank_ix); }

#[no_mangle]
pub extern "C" fn looper_on_playback_stop() {
    for (note, is_playing) in playing_notes().iter_mut().enumerate() {
        if *is_playing {
            unsafe { release_note(note as u8) };
            *is_playing = false;
        }
    }

    let ctx = ctx();
    if let Some(next_bank_ix) = ctx.next_bank_ix {
        ctx.active_bank_ix = next_bank_ix;
        ctx.next_bank_ix = None;
    }
}

#[no_mangle]
pub extern "C" fn looper_process(cur_beat: f32) {
    let ctx = ctx();
    let loop_beat = cur_beat % ctx.loop_len_beats;

    if loop_beat < ctx.last_beat {
        ctx.last_beat = loop_beat;
        ctx.next_evt_ix = Some(0);

        looper_on_playback_stop();
    }

    let bank = &midi_banks()[ctx.active_bank_ix];
    if bank.is_empty() {
        return;
    }

    while let Some(next_evt_ix) = ctx.next_evt_ix {
        let evt = &bank[next_evt_ix];
        if evt.beat > loop_beat {
            break;
        }
        if evt.is_gate {
            playing_notes()[evt.note as usize] = true;
            unsafe { play_note(evt.note) };
        } else {
            playing_notes()[evt.note as usize] = false;
            unsafe { release_note(evt.note) };
        }

        ctx.next_evt_ix = if next_evt_ix + 1 < bank.len() {
            Some(next_evt_ix + 1)
        } else {
            None
        };
    }

    ctx.last_beat = loop_beat;
}
