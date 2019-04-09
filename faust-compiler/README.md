# Faust Compiler Microservice

This is a microservice that serves a single purpose: Compiling Faust code that is sent to it into WebAssembly that can then be loaded and run natively from within the web synth application. It is written in `go` because `go` is supposed to be good for this sort of thing.

A Dockerfile is provided that can run this application from scratch and has the added benefit of being containerized since we're accepting arbitrary user input here.
