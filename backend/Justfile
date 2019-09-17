docker-build:
  docker build -t ameo/notes-backend:latest .

docker-push:
  docker push ameo/notes-backend:latest

docker-run:
  docker kill notes-backend || true
  docker rm notes-backend || true
  docker run -p 7467:7467 -d --name notes-backend ameo/notes-backend:latest

run:
  cargo run
