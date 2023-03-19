const LOOKUP_TABLE_SIZE: usize = 1024 * 16;

static mut SINE_LOOKUP_TABLE: *mut [f32; LOOKUP_TABLE_SIZE] = std::ptr::null_mut();
pub fn get_sine_lookup_table() -> &'static [f32; LOOKUP_TABLE_SIZE] {
  unsafe { &*SINE_LOOKUP_TABLE }
}

static mut TRIANGLE_LOOKUP_TABLE: *mut [f32; LOOKUP_TABLE_SIZE] = std::ptr::null_mut();
pub fn get_triangle_lookup_table() -> &'static [f32; LOOKUP_TABLE_SIZE] {
  unsafe { &*TRIANGLE_LOOKUP_TABLE }
}

static mut SAWTOOTH_LOOKUP_TABLE: *mut [f32; LOOKUP_TABLE_SIZE] = std::ptr::null_mut();
pub fn get_sawtooth_lookup_table() -> &'static [f32; LOOKUP_TABLE_SIZE] {
  unsafe { &*SAWTOOTH_LOOKUP_TABLE }
}

#[inline(always)]
fn uninit<T>() -> T { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }

#[cold]
pub fn maybe_init_lookup_tables() {
  unsafe {
    if SINE_LOOKUP_TABLE.is_null() {
      SINE_LOOKUP_TABLE = Box::into_raw(Box::new(uninit()));

      for i in 0..LOOKUP_TABLE_SIZE {
        *(*SINE_LOOKUP_TABLE).get_unchecked_mut(i) =
          (std::f32::consts::PI * 2. * (i as f32 / LOOKUP_TABLE_SIZE as f32)).sin();
      }
    }

    if TRIANGLE_LOOKUP_TABLE.is_null() {
      TRIANGLE_LOOKUP_TABLE = Box::into_raw(Box::new(uninit()));

      for i in 0..LOOKUP_TABLE_SIZE {
        let phase = ((i as f64) / (LOOKUP_TABLE_SIZE as f64)) as f32;

        *(*TRIANGLE_LOOKUP_TABLE).get_unchecked_mut(i) = if phase < 0.25 {
          4. * phase
        } else if phase < 0.5 {
          let adjusted_phase = phase - 0.25;
          1. - 4. * adjusted_phase
        } else if phase < 0.75 {
          let adjusted_phase = phase - 0.5;
          -adjusted_phase * 4.
        } else {
          let adjusted_phase = phase - 0.75;
          -1. + (adjusted_phase * 4.)
        };
      }
    }

    if SAWTOOTH_LOOKUP_TABLE.is_null() {
      SAWTOOTH_LOOKUP_TABLE = Box::into_raw(Box::new(uninit()));

      for i in 0..LOOKUP_TABLE_SIZE {
        let phase = ((i as f64) / (LOOKUP_TABLE_SIZE as f64)) as f32;

        // rise y=[0,1] from x=[0,0.5], then rise from y=[-1,0] from x=[0.5,1]
        *(*SAWTOOTH_LOOKUP_TABLE).get_unchecked_mut(i) = if phase < 0.5 {
          2. * phase
        } else {
          -1. + (2. * (phase - 0.5))
        };
      }
    }
  }
}
