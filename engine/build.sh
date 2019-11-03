cargo build --target wasm32-unknown-unknown
cd libs && \
  cd midi && cargo build --target wasm32-unknown-unknown && \
  cd ../spectrum_viz && cargo build --target wasm32-unknown-unknown
