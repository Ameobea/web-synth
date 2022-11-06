cargo build --release --target wasm32-unknown-unknown --workspace --exclude common --exclude dsp --exclude wbg_logging &&
  mv ./target/wasm32-unknown-unknown/release/wavetable.wasm ./target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm &&
  cd wavetable && RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --target wasm32-unknown-unknown --release --features=simd
