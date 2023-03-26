cargo build --release --target wasm32-unknown-unknown --workspace \
  --exclude common --exclude dsp --exclude wbg_logging --exclude wavegen --exclude level_detector --exclude granular --exclude vocoder &&
  mv ./target/wasm32-unknown-unknown/release/wavetable.wasm ./target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm &&
  cd wavegen && cargo build --target wasm32-unknown-unknown --release &&
  cd ../level_detector && cargo build --target wasm32-unknown-unknown --release &&
  cd ../granular && cargo build --target wasm32-unknown-unknown --release &&
  cd ../vocoder && cd RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --target wasm32-unknown-unknown --release
  cd .. &&
  cd wavetable && RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --target wasm32-unknown-unknown --release --features=simd
