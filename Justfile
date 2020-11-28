opt:
  wasm-strip ./dist/wavetable.wasm
  wasm-strip ./dist/granular.wasm
  for file in `ls ./dist | grep "\\.wasm"`; do wasm-opt ./dist/$file -O4 -c -o ./dist/$file; done

build-all:
  cd engine \
    && ./release.sh \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/engine.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/midi.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/polysynth.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/waveform_renderer.wasm --browser --remove-producers-section --out-dir ./build
  cp ./engine/build/* ./src
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/granular.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/event_scheduler.wasm ./public
  yarn build || npm build

  just opt

run:
  cd engine \
    && ./build.sh \
    && wasm-bindgen ./target/wasm32-unknown-unknown/debug/engine.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/debug/midi.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/debug/polysynth.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/waveform_renderer.wasm --browser --remove-producers-section --out-dir ./build
  cp ./engine/build/* ./src/
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/granular.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/event_scheduler.wasm ./public
  yarn start

run-frontend:
  yarn start

deploy:
  cd backend && just docker-build
  docker tag ameo/notes-backend:latest $BACKEND_IMAGE_NAME
  docker push $BACKEND_IMAGE_NAME

  cd faust-compiler && just docker-build
  docker tag ameo/faust-compiler-server:latest $FAUST_COMPILER_IMAGE_NAME
  docker push $FAUST_COMPILER_IMAGE_NAME

  gcloud config set run/region $GCLOUD_REGION

  gcloud beta run deploy $BACKEND_SERVICE_NAME \
    --platform managed \
    --set-env-vars="ROCKET_DATABASES=$ROCKET_DATABASES,AUTH_TOKEN=$AUTH_TOKEN,ROCKET_ADDRESS=0.0.0.0" \
    --image $BACKEND_IMAGE_NAME

  gcloud beta run deploy $FAUST_COMPILER_SERVICE_NAME \
    --platform managed \
    --set-env-vars="FAUST_WORKLET_TEMPLATE_FILE_NAME=/opt/faustWorkletTemplate.template.js,AUTH_TOKEN=$AUTH_TOKEN" \
    --image $FAUST_COMPILER_IMAGE_NAME

  just build-all
  phost update notes patch ./dist

build-docker-ci:
  docker build -t $CI_BUILDER_DOCKER_IMAGE_NAME -f Dockerfile.CI .

push-docker-ci:
  docker login docker.pkg.github.com --username $GITHUB_USERNAME -p $GITHUB_TOKEN
  docker push $CI_BUILDER_DOCKER_IMAGE_NAME

build-waveform-renderer:
  cd ./engine/waveform_renderer && cargo build --release --target wasm32-unknown-unknown && \
    wasm-bindgen ../target/wasm32-unknown-unknown/release/waveform_renderer.wasm --browser --remove-producers-section --out-dir ../../src

build-granular:
  cd ./engine/granular && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/granular.wasm ../../public
