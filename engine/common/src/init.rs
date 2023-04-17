use rand::prelude::*;
use rand_pcg::Pcg32;

use super::{rng, RNG};

/// Initialize our PRNG with provided seed if provided or a defualt seed
pub fn init_rng(rng_seed: Option<u64>) {
  // Initialize the global PRNG
  unsafe {
    // slightly customized versions of the default seeds for the PCG32 PRNG, but seeded with
    // some actual RNG from JS so that things aren't deterministic.
    RNG = Pcg32::new(
      rng_seed.unwrap_or(0xcafef00dd15ea5e5),
      721_347_520_420_481_703,
    );
  }

  // Pump it a few times because it seems to generate a fully null output the first time
  let _: usize = rng().gen();
  let _: usize = rng().gen();
}

static mut IS_INITIALIZED: bool = false;

pub fn maybe_init(rng_seed: Option<u64>) {
  if unsafe { IS_INITIALIZED } {
    return;
  }
  unsafe { IS_INITIALIZED = true };

  init_rng(rng_seed);
}
