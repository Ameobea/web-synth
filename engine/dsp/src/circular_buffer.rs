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
        if self.head >= self.buffer.len() {
            self.head = 0;
        }

        self.buffer[self.head] = val;
    }

    /// Returns the value at `head + ix` in the buffer; you're always going to want this to be
    /// negative to avoid reading either old or uninitialized values
    #[inline]
    pub const fn get(&self, ix: isize) -> f32 {
        let ix = (self.head as isize + ix).abs() % (self.buffer.len() as isize);
        self.buffer[if ix > 0 {
            ix as usize
        } else {
            (self.buffer.len() as isize - ix) as usize
        }]
    }

    #[inline]
    pub fn read_interpolated(&self, sample_ix: f32) -> f32 {
        let base_ix = sample_ix.trunc();
        let next_ix = base_ix + (1. * sample_ix.signum());

        let base_val = self.get(base_ix as isize);
        let next_val = self.get(next_ix as isize);
        crate::mix(1. - sample_ix.fract().abs(), base_val, next_val)
    }
}
