use common::ref_static_mut;
use dsp::{band_splitter::BandSplitter, FRAME_SIZE};

static mut INPUT_BUFFER: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];
static mut BAND_SPLITTER: *mut BandSplitter = std::ptr::null_mut();
static mut LOW_BAND_OUTPUT_BUFFER: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];
static mut MID_BAND_OUTPUT_BUFFER: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];
static mut HIGH_BAND_OUTPUT_BUFFER: [f32; FRAME_SIZE] = [0.0; FRAME_SIZE];

#[no_mangle]
pub extern "C" fn init() {
  unsafe {
    BAND_SPLITTER = Box::into_raw(Box::new(BandSplitter::new()));
  }
}

#[no_mangle]
pub extern "C" fn get_input_buf_ptr() -> *mut f32 {
  std::ptr::addr_of_mut!(INPUT_BUFFER) as *mut f32
}

#[no_mangle]
pub extern "C" fn get_low_output_buf_ptr() -> *mut f32 {
  std::ptr::addr_of_mut!(LOW_BAND_OUTPUT_BUFFER) as *mut f32
}

#[no_mangle]
pub extern "C" fn get_mid_output_buf_ptr() -> *mut f32 {
  std::ptr::addr_of_mut!(MID_BAND_OUTPUT_BUFFER) as *mut f32
}

#[no_mangle]
pub extern "C" fn get_high_output_buf_ptr() -> *mut f32 {
  std::ptr::addr_of_mut!(HIGH_BAND_OUTPUT_BUFFER) as *mut f32
}

#[no_mangle]
pub extern "C" fn process() {
  let splitter = unsafe { &mut *BAND_SPLITTER };

  splitter.apply_frame(
    ref_static_mut!(INPUT_BUFFER),
    ref_static_mut!(LOW_BAND_OUTPUT_BUFFER),
    ref_static_mut!(MID_BAND_OUTPUT_BUFFER),
    ref_static_mut!(HIGH_BAND_OUTPUT_BUFFER),
  );
}
