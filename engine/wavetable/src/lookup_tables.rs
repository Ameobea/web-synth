const SINE_LOOKUP_TABLE_SIZE: usize = 1024 * 16;
static mut SINE_LOOKUP_TABLE: *mut [f32; SINE_LOOKUP_TABLE_SIZE] = std::ptr::null_mut();
pub fn get_sine_lookup_table() -> &'static [f32; SINE_LOOKUP_TABLE_SIZE] {
    unsafe { &*SINE_LOOKUP_TABLE }
}

#[cold]
pub fn maybe_init_lookup_tables() {
    unsafe {
        if SINE_LOOKUP_TABLE.is_null() {
            SINE_LOOKUP_TABLE = Box::into_raw(box std::mem::MaybeUninit::uninit().assume_init());
            let lookup_table_size = SINE_LOOKUP_TABLE_SIZE;

            for i in 0..(lookup_table_size) {
                *(*SINE_LOOKUP_TABLE).get_unchecked_mut(i) =
                    (std::f32::consts::PI * 2. * (i as f32 / lookup_table_size as f32)).sin();
            }
        }
    }
}
