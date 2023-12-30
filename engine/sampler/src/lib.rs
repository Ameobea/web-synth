pub struct SamplerCtx {}

#[no_mangle]
pub extern "C" fn init_sampler_ctx() -> *mut SamplerCtx {
  let ctx = SamplerCtx {};
  Box::into_raw(Box::new(ctx))
}
