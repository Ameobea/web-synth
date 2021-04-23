opt:
  # for file in `ls ./dist | grep "\\.wasm"`; do wasm-snip ./dist/$file -o ./dist/$file; done
  # `wasm-strip` doesn't deal with simd, so we manually strip off DWARF debug info from Wasm modules that use SIMD
  wasm-opt ./dist/wavetable.wasm -g --strip-dwarf -o ./dist/wavetable.wasm
  for file in `ls ./dist | grep "\\.wasm"`; do wasm-opt ./dist/$file -g -O4 --enable-simd --enable-nontrapping-float-to-int --precompute-propagate --fast-math --detect-features --strip-dwarf -c -o ./dist/$file; done
  svgo -p 1 --multipass -f ./dist -o ./dist

opt-public:
  # for file in `ls ./public | grep "\\.wasm"`; do wasm-snip ./public/$file -o ./public/$file --snip-rust-fmt-code --snip-rust-panicking-code; done
  for file in `ls ./public | grep "\\.wasm"`; do echo $file && wasm-opt ./public/$file -O4 --enable-simd --enable-nontrapping-float-to-int --precompute-propagate --fast-math --detect-features -g --strip-dwarf -c -o ./public/$file; done

opt-public-profiling:
  # for file in `ls ./public | grep "\\.wasm"`; do wasm-snip ./public/$file -o ./public/$file --snip-rust-fmt-code --snip-rust-panicking-code; done
  for file in `ls ./public | grep "\\.wasm"`; do echo $file && wasm-opt ./public/$file -O4 --enable-simd --enable-nontrapping-float-to-int --precompute-propagate --fast-math --detect-features -g -c -o ./public/$file; done

build-docs:
  cd docs/_layouts && yarn build
  rm -rf ./dist/docs
  cp -r ./docs/_layouts/public ./dist/docs

debug-sinsy:
  cd src/vocalSynthesis && just debug
  cp src/vocalSynthesis/build/sinsy.* ./public

build-sinsy:
  cd src/vocalSynthesis && just build
  cp src/vocalSynthesis/build/sinsy.* ./public

build-all:
  cd engine \
    && ./release.sh \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/engine.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/midi.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/polysynth.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/waveform_renderer.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/note_container.wasm --browser --remove-producers-section --out-dir ./build
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/granular.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/event_scheduler.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sidechain.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/noise_gen.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/distortion.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/adsr.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/note_container.wasm ./public
  cp ./engine/build/* ./src

  just build-sinsy

  yarn build || npm build

  just opt

  just build-docs

run:
  cd engine \
    && ./build.sh \
    && rm -rf /tmp/wasm \
    && mkdir /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/debug/*.wasm /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/release/waveform_renderer.wasm /tmp/wasm \
    && wasm-bindgen /tmp/wasm/engine.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/midi.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/spectrum_viz.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/polysynth.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/waveform_renderer.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/note_container.wasm --browser --remove-producers-section --out-dir ./build
  cp ./engine/build/* ./src/
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/granular.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/event_scheduler.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sidechain.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/noise_gen.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/distortion.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/adsr.wasm ./public

  just debug-sinsy

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
    --set-env-vars="FAUST_WORKLET_TEMPLATE_FILE_NAME=/opt/faustWorkletTemplate.template.js,SOUL_WORKLET_TEMPLATE_FILE_NAME=/opt/SoulAWP.template.js,AUTH_TOKEN=$AUTH_TOKEN" \
    --image $FAUST_COMPILER_IMAGE_NAME

  just build-all
  phost update notes patch ./dist
  rsync -Prv -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -F /dev/null" --delete ./dist/* debian@synth.ameo.design:/var/www/synth/

loc:
  tokei --exclude src/vocalSynthesis/hts_engine_API --exclude src/vocalSynthesis/sinsy .

build-docker-ci:
  docker build -t $CI_BUILDER_DOCKER_IMAGE_NAME -f Dockerfile.CI .

push-docker-ci:
  docker login docker.pkg.github.com --username $GITHUB_USERNAME -p $GITHUB_TOKEN
  docker push $CI_BUILDER_DOCKER_IMAGE_NAME

debug-engine:
  cd ./engine/engine && cargo build --target wasm32-unknown-unknown && \
  cd .. && wasm-bindgen ./target/wasm32-unknown-unknown/debug/engine.wasm --browser --remove-producers-section --out-dir ./build && \
  cp ./build/* ../src

build-wavetable:
  cd ./engine/wavetable && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/wavetable.wasm ../../public

debug-adsr:
  cd ./engine/adsr && cargo build --features=exports --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/adsr.wasm ../../public

build-adsr:
  cd ./engine/adsr && cargo build --release --features=exports --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/adsr.wasm ../../public

build-scheduler:
  cd ./engine/event_scheduler && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/event_scheduler.wasm ../../public

build-spectrum-viz:
  cd ./engine/spectrum_viz && cargo build --release --target wasm32-unknown-unknown && \
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/release/spectrum_viz.wasm --browser --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/spectrum* ./src/

build-midi:
  cd ./engine/midi && cargo build --target wasm32-unknown-unknown && \
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/debug/midi.wasm --browser --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/midi* ./src/

debug-note-container:
  cd ./engine/note_container && cargo build --target wasm32-unknown-unknown && \
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/debug/note_container.wasm --browser --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/note_container* ./src/
