cargo build --target wasm32-unknown-unknown --release
cd libs && \
  cd midi && cargo build --target wasm32-unknown-unknown --release
