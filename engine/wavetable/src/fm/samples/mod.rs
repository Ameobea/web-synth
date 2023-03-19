mod sample_mapping;
mod tuned_sample;

pub use self::{
  sample_mapping::{SampleMappingEmitter, SampleMappingManager, SampleMappingOperatorConfig},
  tuned_sample::TunedSampleEmitter,
};

#[derive(Default)]
pub struct SampleManager {
  pub samples: Vec<Vec<f32>>,
}

static mut SAMPLE_MANAGER: *mut SampleManager = std::ptr::null_mut();

pub fn init_sample_manager() {
  unsafe {
    if SAMPLE_MANAGER.is_null() {
      SAMPLE_MANAGER = Box::into_raw(Box::new(SampleManager::default()));
    }
  }
}

pub fn sample_manager() -> &'static mut SampleManager { unsafe { &mut *SAMPLE_MANAGER } }
