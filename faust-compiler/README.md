# Faust Compiler Microservice

This is a microservice that serves a single purpose: Compiling Faust code that is sent to it into WebAssembly that can then be loaded and run natively from within the web synth application. It is written in `go` because `go` is supposed to be good for this sort of thing.

A Dockerfile is provided that can run this application from scratch and has the added benefit of being containerized since we're accepting arbitrary user input here.

## Building + Running with Docker

1. `docker build -t ameo/faust-compiler-server .`
1. `docker run -it -p 4565:4565 ameo/faust-compiler-server`

## Interacting With the Server

The server currently has a single API endpoint: `POST /compile`. Simply POST a form data request to the server with a file field named "code.faust", and the server will return you the binary content of the generated wasm file in the response if everything went well. Errors get logged to `stdout` and return 400 or 500 response codes. Internally, it just calls the `faust` compiler with the uploaded file content.
