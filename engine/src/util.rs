pub fn tern<T>(cond: bool, if_true: T, if_false: T) -> T {
    if cond {
        if_true
    } else {
        if_false
    }
}

pub fn clamp(val: f32, min: f32, max: f32) -> f32 { val.max(min).min(max) }
