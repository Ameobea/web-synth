export RUSTFLAGS="-Ctarget-feature=+simd128"

cd engine && cargo build --target wasm32-unknown-unknown --release &&
  cd ../midi && cargo build --target wasm32-unknown-unknown --release &&
  cd ../polysynth && cargo build --target wasm32-unknown-unknown --release --features wasm-bindgen-exports &&
  cd ../wavetable && RUSTFLAGS="" cargo build --release --target wasm32-unknown-unknown --no-default-features &&
  mv ../target/wasm32-unknown-unknown/release/wavetable.wasm ../target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm &&
  cd ../spectrum_viz && cargo build --target wasm32-unknown-unknown --release &&
  cd ../wavetable && cargo build --target wasm32-unknown-unknown --release &&
  cd ../waveform_renderer && cargo build --target wasm32-unknown-unknown --release &&
  cd ../granular && cargo build --release --target wasm32-unknown-unknown &&
  cd ../event_scheduler && cargo build --release --target wasm32-unknown-unknown &&
  cd ../sidechain && cargo build --release --target wasm32-unknown-unknown &&
  cd ../noise_gen && cargo build --release --target wasm32-unknown-unknown &&
  cd ../distortion && cargo build --release --target wasm32-unknown-unknown &&
  cd ../adsr && cargo build --features=exports --release --target wasm32-unknown-unknown &&
  cd ../note_container && cargo build --release --target wasm32-unknown-unknown &&
  cd ../sample_editor && cargo build --release --target wasm32-unknown-unknown &&
  cd ../delay && cargo build --release --target wasm32-unknown-unknown
