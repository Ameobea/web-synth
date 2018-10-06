cd engine \
  && ./release.sh \
  && wasm-gc target/wasm32-unknown-unknown/release/*.wasm \
  && wasm-bindgen ./target/wasm32-unknown-unknown/release/*.wasm --out-dir ./build
cd -
cp ./engine/build/* ./src
yarn build || npm build
./opt.sh

