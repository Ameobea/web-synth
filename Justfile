opt:
  wasm-opt ./dist/*.wasm -O4 -c -o ./dist/*.wasm

build-all:
  cd engine \
    && ./release.sh \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/*.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./libs/midi/target/wasm32-unknown-unknown/release/*.wasm --browser --remove-producers-section --out-dir ./build
  cd -
  cp ./engine/build/* ./src
  yarn build || npm build
  just opt
