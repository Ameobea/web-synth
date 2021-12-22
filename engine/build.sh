cd engine && cargo build --target wasm32-unknown-unknown &&
  cd ../midi && cargo build --target wasm32-unknown-unknown &&
  cd ../polysynth && cargo build --target wasm32-unknown-unknown --features wasm-bindgen-exports &&
  cd ../wavetable && cargo build --release --target wasm32-unknown-unknown --no-default-features &&
  mv ../target/wasm32-unknown-unknown/release/wavetable.wasm ../target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm &&
  cd ../spectrum_viz && cargo build --release --target wasm32-unknown-unknown &&
  cd ../wavetable && RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --release --target wasm32-unknown-unknown &&
  cd ../waveform_renderer && cargo build --release --target wasm32-unknown-unknown &&
  cd ../granular && cargo build --release --target wasm32-unknown-unknown &&
  cd ../event_scheduler && cargo build --release --target wasm32-unknown-unknown &&
  cd ../sidechain && cargo build --release --target wasm32-unknown-unknown &&
  cd ../noise_gen && cargo build --release --target wasm32-unknown-unknown &&
  cd ../distortion && cargo build --release --target wasm32-unknown-unknown &&
  cd ../adsr && cargo build --features=exports --release --target wasm32-unknown-unknown &&
  cd ../note_container && cargo build --release --target wasm32-unknown-unknown &&
  cd ../sample_editor && cargo build --release --target wasm32-unknown-unknown &&
  cd ../delay && cargo build --release --target wasm32-unknown-unknown &&
  cd ../sample_player && cargo build --release --target wasm32-unknown-unknown &&
  cd ../wav_decoder && cargo build --release --target wasm32-unknown-unknown &&
  cd ../looper && cargo build --release --target wasm32-unknown-unknown &&
  cd ../midi_quantizer && cargo build --release --target wasm32-unknown-unknown
