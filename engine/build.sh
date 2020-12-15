cd engine && cargo build --target wasm32-unknown-unknown && \
  cd ../midi && cargo build --target wasm32-unknown-unknown && \
  cd ../polysynth && cargo build --target wasm32-unknown-unknown --features wasm-bindgen-exports && \
  cd ../spectrum_viz && cargo build --release --target wasm32-unknown-unknown && \
  cd ../wavetable && cargo build --release --target wasm32-unknown-unknown && \
  cd ../waveform_renderer && cargo build --release --target wasm32-unknown-unknown && \
  cd ../granular && cargo build --release --target wasm32-unknown-unknown && \
  cd ../event_scheduler && cargo build --release --target wasm32-unknown-unknown && \
  cd ../sidechain && cargo build --release --target wasm32-unknown-unknown && \
  cd ../noise_gen && cargo build --release --target wasm32-unknown-unknown
