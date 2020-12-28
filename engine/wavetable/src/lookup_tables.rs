static mut SINE_LOOKUP_TABLE: *mut [f32; 1024 * 4] = std::ptr::null_mut();
pub fn get_sine_lookup_table() -> &'static [f32; 1024 * 4] { unsafe { &*SINE_LOOKUP_TABLE } }

pub fn maybe_init_lookup_tables() {
    unsafe {
        if SINE_LOOKUP_TABLE.is_null() {
            SINE_LOOKUP_TABLE = Box::into_raw(box std::mem::MaybeUninit::uninit().assume_init());
            let lookup_table_size = (*SINE_LOOKUP_TABLE).len();
            for i in 0..(lookup_table_size) {
                (*SINE_LOOKUP_TABLE)[i] =
                    (std::f32::consts::PI * 2. * (i as f32 / lookup_table_size as f32)).sin();
            }
        }
    }
}
