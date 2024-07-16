set dotenv-load := true

opt:
  for file in `ls ./dist | grep "\\.wasm"`; do wasm-opt ./dist/$file -g --strip-dwarf -O4 --enable-simd --precompute-propagate --fast-math --detect-features --strip-dwarf -c -o ./dist/$file; done
  for file in `ls ./dist/headless | grep "\\.wasm"`; do wasm-opt ./dist/headless/$file -g --strip-dwarf -O4 --enable-simd --precompute-propagate --fast-math --detect-features --strip-dwarf -c -o ./dist/headless/$file; done
  svgo -p 1 --multipass -f ./dist -o ./dist
  svgo -p 1 --multipass -f ./dist/icons/music_notes -o ./dist/icons/music_notes

opt-public:
  # for file in `ls ./public | grep "\\.wasm"`; do wasm-snip ./public/$file -o ./public/$file --snip-rust-fmt-code --snip-rust-panicking-code; done
  for file in `ls ./public | grep "\\.wasm"`; do echo $file && wasm-opt ./public/$file -O4 --enable-simd --precompute-propagate --fast-math --detect-features -g --strip-dwarf -c -o ./public/$file; done

opt-public-profiling:
  # for file in `ls ./public | grep "\\.wasm"`; do wasm-snip ./public/$file -o ./public/$file --snip-rust-fmt-code --snip-rust-panicking-code; done
  for file in `ls ./public | grep "\\.wasm"`; do echo $file && wasm-opt ./public/$file -O4 --enable-simd --precompute-propagate --fast-math --detect-features -g -c -o ./public/$file; done

build-docs:
  cd docs/_layouts && yarn build
  rm -rf ./dist/docs
  cp -r ./docs/_layouts/public ./dist/docs

debug-sinsy:
  cd src/vocalSynthesis && just debug
  cp src/vocalSynthesis/build/sinsy.* ./public

build-sinsy:
  # cd src/vocalSynthesis && just build
  # cp src/vocalSynthesis/build/sinsy.* ./public

fix-litegraph:
  #!/usr/bin/env bash
  set -euxo pipefail
  if ! command -v gsed &> /dev/null
  then
      sed -i '/No glmatrix found/c\0;' node_modules/litegraph.js/build/litegraph.js
  else
      gsed -i '/No glmatrix found/c\0;' node_modules/litegraph.js/build/litegraph.js
  fi

  # https://github.com/jagenjo/litegraph.js/pull/287
  if ! command -v gsed &> /dev/null
  then
      sed -i '/e.deltaX = e.localX - this.last_mouse_position\[0\];/c\// e.deltaX = e.localX - this.last_mouse_position[0];' node_modules/litegraph.js/build/litegraph.js
      sed -i '/e.deltaY = e.localY - this.last_mouse_position\[1\];/c\// e.deltaY = e.localY - this.last_mouse_position[1];' node_modules/litegraph.js/build/litegraph.js
  else
      gsed -i '/e.deltaX = e.localX - this.last_mouse_position\[0\];/c\// e.deltaX = e.localX - this.last_mouse_position[0];' node_modules/litegraph.js/build/litegraph.js
      gsed -i '/e.deltaY = e.localY - this.last_mouse_position\[1\];/c\// e.deltaY = e.localY - this.last_mouse_position[1];' node_modules/litegraph.js/build/litegraph.js
  fi

build-all:
  #!/bin/bash

  just fix-litegraph

  cd engine \
    && ./release.sh \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/engine.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/midi.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/polysynth.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/waveform_renderer.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/note_container.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/wav_decoder.wasm --browser --remove-producers-section --out-dir ./build

  cd -
  cp ./engine/target/wasm32-unknown-unknown/release/*.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/granular.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/event_scheduler.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sidechain.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/noise_gen.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/distortion.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/adsr.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/note_container.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sample_editor.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/delay.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sample_player.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/looper.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/midi_quantizer.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/quantizer.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/compressor.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/vocoder.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/level_detector.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/wavegen.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/multiband_diode_ladder_distortion.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/midi_renderer.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/oscilloscope.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/spectrum_viz_full.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sampler.wasm ./public
  cp ./engine/build/* ./src

  just build-sinsy

  yarn build || npm build

  just build-headless

  just opt

  just build-docs

build-headless:
  yarn build-headless || npm build-headless

run:
  #!/bin/bash

  just fix-litegraph

  cd engine \
    && ./release.sh \
    && rm -rf /tmp/wasm \
    && mkdir /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/release/*.wasm /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/release/spectrum_viz.wasm /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/release/waveform_renderer.wasm /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/release/note_container.wasm /tmp/wasm \
    && cp ./target/wasm32-unknown-unknown/release/wav_decoder.wasm /tmp/wasm \
    && wasm-bindgen /tmp/wasm/engine.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/midi.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/spectrum_viz.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/polysynth.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/waveform_renderer.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/note_container.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen /tmp/wasm/wav_decoder.wasm --browser --remove-producers-section --out-dir ./build

  cd -
  cp ./engine/build/* ./src/
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/wavetable_no_simd.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/granular.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/event_scheduler.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sidechain.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/noise_gen.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/distortion.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/adsr.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/note_container.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sample_editor.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/delay.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sample_player.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/looper.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/midi_quantizer.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/quantizer.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/compressor.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/vocoder.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/level_detector.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/wavegen.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/multiband_diode_ladder_distortion.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/midi_renderer.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/oscilloscope.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/spectrum_viz_full.wasm ./public
  cp ./engine/target/wasm32-unknown-unknown/release/sampler.wasm ./public

  just debug-sinsy

  yarn start

run-frontend:
  yarn start

deploy:
  # cd backend && just docker-build
  # docker tag ameo/notes-backend:latest $BACKEND_IMAGE_NAME
  # docker push $BACKEND_IMAGE_NAME

  # cd faust-compiler && just docker-build
  # docker tag ameo/faust-compiler-server:latest $FAUST_COMPILER_IMAGE_NAME
  # docker push $FAUST_COMPILER_IMAGE_NAME

  # gcloud config set run/region $GCLOUD_REGION

  # gcloud beta run deploy $BACKEND_SERVICE_NAME \
  #   --platform managed \
  #   --set-env-vars="ROCKET_DATABASES=$ROCKET_DATABASES,AUTH_TOKEN=$AUTH_TOKEN,ROCKET_ADDRESS=0.0.0.0" \
  #   --image $BACKEND_IMAGE_NAME

  # gcloud beta run deploy $FAUST_COMPILER_SERVICE_NAME \
  #   --platform managed \
  #   --set-env-vars="FAUST_WORKLET_TEMPLATE_FILE_NAME=/opt/faustWorkletTemplate.template.js,SOUL_WORKLET_TEMPLATE_FILE_NAME=/opt/SoulAWP.template.js,AUTH_TOKEN=$AUTH_TOKEN" \
  #   --image $FAUST_COMPILER_IMAGE_NAME

  # just build-all
  # phost update notes patch ./dist
  rsync -Prv -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -F /dev/null" ./dist/* debian@synth.ameo.dev:/var/www/synth.ameo.dev/

deploy-headless:
  phost update web-synth-headless-test patch dist/headless

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

build-engine:
  cd ./engine/engine && cargo build --release --target wasm32-unknown-unknown && \
  cd .. && wasm-bindgen ./target/wasm32-unknown-unknown/release/engine.wasm --browser --remove-producers-section --out-dir ./build && \
  cp ./build/* ../src

build-wavetable:
  cd ./engine/wavetable && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/wavetable.wasm ../../public

debug-wavetable:
  cd ./engine/wavetable && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/wavetable.wasm ../../public

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

build-granular:
  cd ./engine/granular && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/granular.wasm ../../public

build-delay:
  cd ./engine/delay && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/delay.wasm ../../public

build-noise:
  cd ./engine/noise_gen && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/noise_gen.wasm ../../public

build-sample-player:
  cd ./engine/sample_player && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/sample_player.wasm ../../public

debug-sample-player:
  cd ./engine/sample_player && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/sample_player.wasm ../../public

build-wav-decoder:
  cd ./engine/wav_decoder && cargo build --target wasm32-unknown-unknown && \
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/debug/wav_decoder.wasm --browser --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/wav_decoder* ./src/

build-event-scheduler:
  cd ./engine/event_scheduler && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/event_scheduler.wasm ../../public

build-looper:
  cd ./engine/looper && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/looper.wasm ../../public

build-midi-quantizer:
  cd ./engine/midi_quantizer && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/midi_quantizer.wasm ../../public

build-quantizer:
  cd ./engine/quantizer && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/quantizer.wasm ../../public

build-compressor:
  cd ./engine/compressor && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/compressor.wasm ../../public

debug-compressor:
  cd ./engine/compressor && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/compressor.wasm ../../public

build-polysynth:
  cd ./engine/polysynth && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/polysynth.wasm ../../public

build-vocoder:
  cd ./engine/vocoder && RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/vocoder.wasm ../../public

debug-vocoder:
  cd ./engine/vocoder && RUSTFLAGS="-Ctarget-feature=+simd128" cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/vocoder.wasm ../../public

build-level-detector:
  cd ./engine/level_detector && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/level_detector.wasm ../../public

build-wavegen:
  cd ./engine/wavegen && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/wavegen.wasm ../../public

build-mbdld:
  cd ./engine/multiband_diode_ladder_distortion && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/multiband_diode_ladder_distortion.wasm ../../public

build-midi-renderer:
  cd ./engine/midi_renderer && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/midi_renderer.wasm ../../public

build-oscilloscope:
  cd ./engine/oscilloscope && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/oscilloscope.wasm ../../public

debug-oscilloscope:
  cd ./engine/oscilloscope && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/oscilloscope.wasm ../../public

debug-line-spectrogram:
  cd ./engine/spectrum_viz && cargo build --target wasm32-unknown-unknown --no-default-features --features=line_viz && \
    cp ../target/wasm32-unknown-unknown/debug/spectrum_viz.wasm ../../public/spectrum_viz_full.wasm

build-line-spectrogram:
  cd ./engine/spectrum_viz && cargo build --release --target wasm32-unknown-unknown --no-default-features --features=line_viz && \
    cp ../target/wasm32-unknown-unknown/release/spectrum_viz.wasm ../../public/spectrum_viz_full.wasm

build-waveform-renderer:
  cd ./engine/waveform_renderer && cargo build --release --target wasm32-unknown-unknown && \
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/release/waveform_renderer.wasm --browser --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/waveform_renderer* ./src/

build-sampler:
  cd ./engine/sampler && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/sampler.wasm ../../public

debug-sampler:
  cd ./engine/sampler && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/sampler.wasm ../../public
