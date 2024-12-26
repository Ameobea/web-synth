const LOOKUP_TABLE_SIZE: usize = 1024 * 16;

static mut SINE_LOOKUP_TABLE: [f32; LOOKUP_TABLE_SIZE] = [0.; LOOKUP_TABLE_SIZE];

fn get_sine_lookup_table_ptr() -> *const [f32; LOOKUP_TABLE_SIZE] { &raw const SINE_LOOKUP_TABLE }

fn get_sine_lookup_table_ptr_mut() -> *mut [f32; LOOKUP_TABLE_SIZE] { &raw mut SINE_LOOKUP_TABLE }

pub fn get_sine_lookup_table() -> &'static [f32; LOOKUP_TABLE_SIZE] {
  unsafe { &*get_sine_lookup_table_ptr() }
}

#[cold]
pub fn maybe_init_lookup_tables() {
  unsafe {
    if SINE_LOOKUP_TABLE[1] == 0. {
      let base_ptr = get_sine_lookup_table_ptr_mut() as *mut f32;
      for i in 0..LOOKUP_TABLE_SIZE {
        let val = (std::f32::consts::PI * 2. * (i as f32 / LOOKUP_TABLE_SIZE as f32)).sin();
        let ptr = base_ptr.add(i);
        std::ptr::write(ptr, val);
      }
    }
  }
}
