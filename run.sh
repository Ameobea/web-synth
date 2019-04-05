cd engine \
  && ./build.sh \
  && wasm-bindgen ./target/wasm32-unknown-unknown/debug/*.wasm --browser --remove-producers-section --out-dir ./build
cd -
cp ./engine/build/* ./src/
yarn start --port 7777
