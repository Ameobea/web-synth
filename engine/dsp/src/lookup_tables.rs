const LOOKUP_TABLE_SIZE: usize = 1024 * 16;

static mut SINE_LOOKUP_TABLE: *mut [f32; LOOKUP_TABLE_SIZE] = std::ptr::null_mut();
pub fn get_sine_lookup_table() -> &'static [f32; LOOKUP_TABLE_SIZE] {
  unsafe { &*SINE_LOOKUP_TABLE }
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
  }
}
