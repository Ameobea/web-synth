set -e -x

cargo build --release --target wasm32-unknown-unknown --workspace \
  --exclude common --exclude dsp --exclude wbg_logging --exclude spectrum_viz --exclude wavegen &&
  rm -f ./target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm && mv ./target/wasm32-unknown-unknown/release/wavetable.wasm ./target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm &&
  cd spectrum_viz && cargo build --target wasm32-unknown-unknown --release --no-default-features --features=line_viz &&
  cd .. && rm -f ./target/wasm32-unknown-unknown/release/spectrum_viz_full.wasm && mv ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm ./target/wasm32-unknown-unknown/release/spectrum_viz_full.wasm &&
  cd spectrum_viz && cargo build --target wasm32-unknown-unknown --release &&
  cd ../wavetable && RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --target wasm32-unknown-unknown --release --features=simd &&
  cd ../wavegen && RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --target wasm32-unknown-unknown --release
