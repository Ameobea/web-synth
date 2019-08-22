opt:
  for file in `ls ./dist | grep "\\.wasm"`; do wasm-opt ./dist/$file -O4 -c -o ./dist/$file; done

build-all:
  cd engine \
    && ./release.sh \
    && wasm-bindgen ./target/wasm32-unknown-unknown/release/*.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./libs/midi/target/wasm32-unknown-unknown/release/*.wasm --browser --remove-producers-section --out-dir ./build
  cp ./engine/build/* ./src
  yarn build || npm build
  just opt

run:
  cd engine \
    && ./build.sh \
    && wasm-bindgen ./target/wasm32-unknown-unknown/debug/*.wasm --browser --remove-producers-section --out-dir ./build \
    && wasm-bindgen ./libs/midi/target/wasm32-unknown-unknown/debug/*.wasm --browser --remove-producers-section --out-dir ./build
  cp ./engine/build/* ./src/
  yarn start

run-frontend:
  yarn start

bump := "patch"

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
    --set-env-vars="ROCKET_DATABASES=$ROCKET_DATABASES" \
    --image $BACKEND_IMAGE_NAME

  gcloud beta run deploy $FAUST_COMPILER_SERVICE_NAME \
    --platform managed \
    --image $FAUST_COMPILER_IMAGE_NAME

  just build-all
  phost update notes {{bump}} ./dist
