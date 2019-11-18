docker-build:
  docker build -t ameo/faust-compiler-server:latest .

docker-push:
  docker push ameo/faust-compiler-server:latest

docker-run:
  docker kill faust-compiler-server || true
  docker rm faust-compiler-server || true
  docker run -p 4565:4565 -d --name faust-compiler-server ameo/faust-compiler-server:latest

run:
  go build && ./faust-compiler-server
