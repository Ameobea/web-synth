cargo build --target wasm32-unknown-unknown --release
cd libs && \
  cd midi && cargo build --target wasm32-unknown-unknown --release && \
  cd ../midi && cargo build --target wasm32-unknown-unknown --release --features wasm-bindgen-exports && \
  cd ../spectrum_viz && cargo build --target wasm32-unknown-unknown --release
