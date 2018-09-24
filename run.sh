cd engine \
  && ./build.sh \
  && wasm-gc target/wasm32-unknown-unknown/debug/*.wasm \
  && wasm-bindgen ./target/wasm32-unknown-unknown/debug/*.wasm --out-dir ./build
cd -
cp ./engine/build/* ./src/
yarn start
