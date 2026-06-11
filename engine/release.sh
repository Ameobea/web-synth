set -e -x

# wavegen + lfo are built standalone: they depend on waveform_renderer/wavetable with
# default-features = false, and workspace feature unification would leak wasm-bindgen
# and FM-synth exports (with their env.* imports) into their cdylibs
cargo build --release --target wasm32-unknown-unknown --workspace \
  --exclude common --exclude wbg_logging --exclude polysynth --exclude spectrum_viz \
  --exclude wavegen --exclude lfo

cd wavegen
cargo build --target wasm32-unknown-unknown --release
cd ../lfo
cargo build --target wasm32-unknown-unknown --release
cd ..

cd spectrum_viz
cargo build --target wasm32-unknown-unknown --release --no-default-features --features=line_viz
cd ..
rm -f ./target/wasm32-unknown-unknown/release/spectrum_viz_full.wasm
mv ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm ./target/wasm32-unknown-unknown/release/spectrum_viz_full.wasm
cd spectrum_viz
cargo build --target wasm32-unknown-unknown --release
