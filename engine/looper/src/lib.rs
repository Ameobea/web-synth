#![feature(box_syntax)]

use float_ord::FloatOrd;

extern "C" {
    fn play_note(module_ix: usize, note: u8);

    fn release_note(module_ix: usize, note: u8);

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

struct LooperBank {
    pub events: Vec<MIDIEvent>,
    pub len_beats: f32,
}

impl LooperBank {
    pub fn clear(&mut self) { self.events.clear(); }
}

impl Default for LooperBank {
    fn default() -> Self {
        LooperBank {
            events: Vec::new(),
            len_beats: 8.0,
        }
    }
}

struct LooperCtx {
    pub playing_notes: [bool; 1024],
    pub last_beat: f32,
    pub next_evt_ix: Option<usize>,
    pub active_bank_ix: Option<usize>,
    /// Index of the bank to switch to when the current loop finishes
    pub next_bank_ix: Option<usize>,
    pub banks: Vec<LooperBank>,
}

impl Default for LooperCtx {
    fn default() -> Self {
        LooperCtx {
            playing_notes: [false; 1024],
            last_beat: std::f32::INFINITY,
            next_evt_ix: None,
            active_bank_ix: None,
            next_bank_ix: None,
            banks: Vec::new(),
        }
    }
}

static mut CTXS: *mut Vec<LooperCtx> = std::ptr::null_mut();

fn ctxs() -> &'static mut Vec<LooperCtx> { unsafe { &mut *CTXS } }

fn ctx(module_ix: usize) -> &'static mut LooperCtx {
    while ctxs().len() <= module_ix {
        ctxs().push(LooperCtx::default());
    }
    &mut ctxs()[module_ix]
}

#[no_mangle]
pub extern "C" fn looper_init() {
    unsafe {
        CTXS = Box::into_raw(box Vec::new());
    }
}

#[no_mangle]
pub extern "C" fn looper_clear_bank(module_ix: usize, bank_ix: usize) {
    let ctx = ctx(module_ix);
    while ctx.banks.len() <= bank_ix {
        ctx.banks.push(Default::default());
    }
    while ctxs().len() <= module_ix {
        ctxs().push(LooperCtx::default());
    }

    let bank = &mut ctx.banks[bank_ix];
    bank.clear();
}

#[no_mangle]
pub extern "C" fn looper_add_evt(
    module_ix: usize,
    bank_ix: usize,
    note: u8,
    beat: f32,
    is_gate: bool,
) {
    let bank = &mut ctx(module_ix).banks[bank_ix];
    bank.events.push(MIDIEvent {
        note,
        beat,
        is_gate,
    });
}

#[no_mangle]
pub extern "C" fn looper_finalize_bank(module_ix: usize, bank_ix: usize, len_beats: f32) {
    let bank = &mut ctx(module_ix).banks[bank_ix];
    bank.len_beats = len_beats;
    bank.events.sort_unstable();
}

/// Switch immediately to the next bank, skipping ahead in the new one to match the current beat
#[no_mangle]
pub extern "C" fn looper_activate_bank(module_ix: usize, bank_ix: isize, cur_beat: f32) {
    let bank_ix = if bank_ix < 0 {
        None
    } else {
        Some(bank_ix as usize)
    };

    let ctx = ctx(module_ix);
    ctx.active_bank_ix = bank_ix;

    let bank_ix = match bank_ix {
        Some(bank_ix) => bank_ix,
        None => return,
    };
    while ctx.banks.len() <= bank_ix {
        ctx.banks.push(Default::default());
    }

    let bank = &mut ctx.banks[bank_ix];
    let loop_beat = cur_beat % bank.len_beats;
    ctx.last_beat = loop_beat;
    ctx.next_evt_ix = if bank.events.is_empty() {
        None
    } else {
        Some(0)
    };

    while let Some(next_evt_ix) = ctx.next_evt_ix {
        let evt = &bank.events[next_evt_ix];
        if evt.beat > loop_beat {
            break;
        }
        ctx.next_evt_ix = if next_evt_ix + 1 < bank.events.len() {
            Some(next_evt_ix + 1)
        } else {
            None
        };
    }
}

#[no_mangle]
pub extern "C" fn looper_get_playing_bank_ix(module_ix: usize) -> isize {
    match ctx(module_ix).active_bank_ix {
        Some(bank_ix) => bank_ix as isize,
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn looper_set_next_bank_ix(module_ix: usize, bank_ix: usize) {
    ctx(module_ix).next_bank_ix = Some(bank_ix);
}

#[no_mangle]
pub extern "C" fn looper_on_playback_stop() {
    for (module_ix, ctx) in ctxs().iter_mut().enumerate() {
        for (note, is_playing) in ctx.playing_notes.iter_mut().enumerate() {
            if *is_playing {
                unsafe { release_note(module_ix, note as u8) };
                *is_playing = false;
            }
        }
    }

    for ctx in ctxs() {
        if let Some(next_bank_ix) = ctx.next_bank_ix {
            ctx.active_bank_ix = Some(next_bank_ix);
            ctx.next_bank_ix = None;
        }
    }
}

fn process_looper_module(cur_beat: f32, module_ix: usize, ctx: &mut LooperCtx) -> f32 {
    let active_bank_ix = match ctx.active_bank_ix {
        Some(bank_ix) => bank_ix,
        None => return 0.,
    };

    let active_bank = &ctx.banks[active_bank_ix];
    let loop_beat = cur_beat % active_bank.len_beats;

    if loop_beat < ctx.last_beat {
        ctx.last_beat = loop_beat;
        ctx.next_evt_ix = Some(0);

        for (note, is_playing) in ctx.playing_notes.iter_mut().enumerate() {
            if *is_playing {
                unsafe { release_note(module_ix, note as u8) };
                *is_playing = false;
            }
        }

        if let Some(next_bank_ix) = ctx.next_bank_ix {
            ctx.active_bank_ix = Some(next_bank_ix);
            ctx.next_bank_ix = None;
        }

        return process_looper_module(cur_beat, module_ix, ctx);
    }

    if active_bank.events.is_empty() {
        ctx.last_beat = loop_beat;
        return loop_beat / active_bank.len_beats;
    }

    while let Some(next_evt_ix) = ctx.next_evt_ix {
        let evt = &active_bank.events[next_evt_ix];
        if evt.beat > loop_beat {
            break;
        }
        if evt.is_gate {
            ctx.playing_notes[evt.note as usize] = true;
            unsafe { play_note(module_ix, evt.note) };
        } else {
            ctx.playing_notes[evt.note as usize] = false;
            unsafe { release_note(module_ix, evt.note) };
        }

        ctx.next_evt_ix = if next_evt_ix + 1 < active_bank.events.len() {
            Some(next_evt_ix + 1)
        } else {
            None
        };
    }

    ctx.last_beat = loop_beat;

    loop_beat / active_bank.len_beats
}

#[no_mangle]
pub extern "C" fn looper_process(module_ix_for_which_to_report_phase: usize, cur_beat: f32) -> f32 {
    let mut phase = 0.;

    for (module_ix, ctx) in ctxs().iter_mut().enumerate() {
        let module_phase = process_looper_module(cur_beat, module_ix, ctx);
        if module_ix == module_ix_for_which_to_report_phase {
            phase = module_phase;
        }
    }

    phase
}

#[no_mangle]
pub extern "C" fn looper_delete_module(module_ix: usize) {
    if ctxs().len() <= module_ix {
        return;
    }
    ctxs().remove(module_ix);
}

#[no_mangle]
pub extern "C" fn looper_set_loop_len_beats(module_ix: usize, bank_ix: usize, len_beats: f32) {
    let ctx = ctx(module_ix);

    while ctx.banks.len() <= bank_ix {
        ctx.banks.push(Default::default());
    }

    let bank = &mut ctx.banks[bank_ix];
    bank.len_beats = len_beats;
}
