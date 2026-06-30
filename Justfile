set dotenv-load := true

# .wasm modules copied raw into public/ and fetched at runtime
wasm_modules := "wavetable granular event_scheduler sidechain noise_gen distortion adsr sample_editor delay sample_player looper midi_quantizer quantizer compressor vocoder level_detector wavegen multiband_diode_ladder_distortion midi_renderer oscilloscope spectrum_viz_full sampler safety_limiter equalizer lfo filter_viz"
# modules run through wasm-bindgen; JS glue + _bg.wasm land in src/
bindgen_modules := "engine midi spectrum_viz waveform_renderer wav_decoder"

# -g + --strip-dwarf keeps the name section (profiling/Sentry) while dropping DWARF
wasm_opt_flags := "-g --detect-features --fast-math --zero-filled-memory --converge --strip-dwarf -O4 --precompute-propagate"

opt: opt-headless
  for file in `ls ./dist/*.wasm ./dist/assets/*.wasm 2>/dev/null`; do wasm-opt $file {{wasm_opt_flags}} -o $file; done
  svgo -p 1 --multipass -f ./dist -o ./dist
  svgo -p 1 --multipass -f ./dist/icons/music_notes -o ./dist/icons/music_notes

opt-headless:
  for file in `ls ./dist/headless/*.wasm ./dist/headless/assets/*.wasm 2>/dev/null`; do wasm-opt $file {{wasm_opt_flags}} -o $file; done

build-docs:
  cd docs/_layouts && yarn build
  rm -rf ./dist/docs
  cp -r ./docs/_layouts/public ./dist/docs

build-wasm:
  #!/bin/bash
  set -euo pipefail
  cd engine
  ./release.sh
  rm -rf ./build/*
  for module in {{bindgen_modules}}; do
    wasm-bindgen ./target/wasm32-unknown-unknown/release/$module.wasm --target web --remove-producers-section --out-dir ./build
  done
  cd ..
  cp ./engine/build/* ./src/
  for module in {{wasm_modules}}; do
    cp ./engine/target/wasm32-unknown-unknown/release/$module.wasm ./public/
  done

build-all: build-wasm
  yarn build
  just build-headless
  just opt
  just build-docs

build-and-deploy:
  just build-all
  just deploy

build-headless:
  yarn build-headless

run: build-wasm
  yarn start

run-frontend:
  yarn start

deploy:
  # cd backend && just build-and-deploy

  rsync -Prv -e "ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -F /dev/null" ./dist/* debian@synth.ameo.dev:/var/www/synth.ameo.dev/

deploy-headless: opt-headless
  phost update web-synth-headless-test patch dist/headless

loc:
  tokei .

debug-engine:
  cd ./engine/engine && cargo build --target wasm32-unknown-unknown && \
  cd .. && wasm-bindgen ./target/wasm32-unknown-unknown/debug/engine.wasm --target web --remove-producers-section --out-dir ./build && \
  cp ./build/* ../src

build-engine:
  cd ./engine/engine && cargo build --release --target wasm32-unknown-unknown && \
  cd .. && wasm-bindgen ./target/wasm32-unknown-unknown/release/engine.wasm --target web --remove-producers-section --out-dir ./build && \
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
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/release/spectrum_viz.wasm --target web --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/spectrum* ./src/

build-midi:
  cd ./engine/midi && cargo build --target wasm32-unknown-unknown && \
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/debug/midi.wasm --target web --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/midi* ./src/

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
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/debug/wav_decoder.wasm --target web --remove-producers-section --out-dir ./engine/build
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

build-vocoder:
  cd ./engine/vocoder && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/vocoder.wasm ../../public

debug-vocoder:
  cd ./engine/vocoder && cargo build --target wasm32-unknown-unknown && \
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
    cd - && wasm-bindgen ./engine/target/wasm32-unknown-unknown/release/waveform_renderer.wasm --target web --remove-producers-section --out-dir ./engine/build
  cp ./engine/build/waveform_renderer* ./src/

build-sampler:
  cd ./engine/sampler && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/sampler.wasm ../../public

debug-sampler:
  cd ./engine/sampler && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/sampler.wasm ../../public

debug-safety-limiter:
  cd ./engine/safety_limiter && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/safety_limiter.wasm ../../public

build-equalizer:
  cd ./engine/equalizer && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/equalizer.wasm ../../public

debug-equalizer:
  cd ./engine/equalizer && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/equalizer.wasm ../../public

build-filter-viz:
  cd ./engine/filter_viz && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/filter_viz.wasm ../../public

debug-filter-viz:
  cd ./engine/filter_viz && cargo build --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/debug/filter_viz.wasm ../../public

build-lfo:
  cd ./engine/lfo && cargo build --release --target wasm32-unknown-unknown && \
    cp ../target/wasm32-unknown-unknown/release/lfo.wasm ../../public
