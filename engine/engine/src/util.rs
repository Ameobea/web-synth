pub fn tern<T>(cond: bool, if_true: T, if_false: T) -> T {
    if cond {
        if_true
    } else {
        if_false
    }
}

pub fn clamp(val: f32, min: f32, max: f32) -> f32 { val.max(min).min(max) }

pub fn time_to_beats(bpm: f64, time_seconds: f64) -> f64 {
    let time_minutes = time_seconds / 60.;
    time_minutes * bpm
}

pub fn beats_to_seconds(bpm: f64, beats: f64) -> f64 {
    let beats_per_second = bpm / 60.;
    beats / beats_per_second
}
