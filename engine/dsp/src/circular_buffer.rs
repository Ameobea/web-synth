#[derive(Clone)]
pub struct CircularBuffer<const LENGTH: usize> {
  buffer: [f32; LENGTH],
  /// Points to the index that the most recently added value was written to
  head: usize,
}

impl<const LENGTH: usize> CircularBuffer<LENGTH> {
  #[inline]
  pub const fn new() -> Self {
    CircularBuffer {
      buffer: [0.0f32; LENGTH],
      head: 0,
    }
  }

  #[inline]
  pub fn set(&mut self, val: f32) {
    self.head += 1;
    if self.head >= LENGTH {
      self.head = 0;
    }

    self.buffer[self.head] = val;
  }

  /// Returns the value at `head + ix` in the buffer; you're always going to want this to be
  /// negative to avoid reading either old or uninitialized values
  #[inline]
  pub fn get(&self, ix: isize) -> f32 {
    debug_assert!(ix <= 0);
    let ix = (self.head as isize + ix) % (LENGTH as isize);

    if ix >= 0 {
      self.buffer[ix as usize]
    } else {
      self.buffer[(LENGTH as isize + ix) as usize]
    }
  }

  #[inline]
  pub fn read_interpolated(&self, sample_ix: f32) -> f32 {
    if cfg!(debug_assertions) {
      if sample_ix > 0. {
        panic!("sample_ix must be <= 0; found: {sample_ix}");
      }
    }
    if sample_ix == 0. {
      if cfg!(debug_assertions) {
        return self.buffer[self.head];
      } else {
        return *unsafe { self.buffer.get_unchecked(self.head) };
      }
    }
    let base_ix = sample_ix.trunc() as isize;
    let next_ix = base_ix - 1;

    let base_val = self.get(base_ix);
    let next_val = self.get(next_ix);
    crate::mix(1. - sample_ix.fract().abs(), base_val, next_val)
  }

  #[inline]
  pub fn fill(&mut self, val: f32) { self.buffer.fill(val); }
}
