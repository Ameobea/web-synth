# Web Synth and Digial Audio Workstation

This is a web-based DAW (Digital Audio Workstation) written in Rust/WebAssembly and TypeScript. Its goal is to provide users with the tools they need to create unique sounds and audio compositions within the context of the web browser. It makes use of the WebAudio API.

This project is still in its early stages. At the time of writing this, it really can't be used for any kind of meaningful work. However, the pieces are there and all it really requires right now is some cohesion between them as well as quality-of-life features.

## Installation

### Running via Docker

If you'd prefer to avoid manually installing all of the software required to build + run this application, you can make use of the Docker build functionality. Just make sure you have Docker installed and run the provided `docker_build_all.sh` file. It will handle building the project and serving it on [http://localhost:7777/](http://localhost:7777/). Please note that the Docker image is very big (>1GB).

### Building + Installing from Scratch

You'll need a few pieces of software in order to build this. They're mainly for compiling, transforming, and optimizing the WebAssembly blobs that are created as output fro the Rust application.

You must have several tools installed in order to use this template:

- The Rust programming language (nightly version): https://rustup.rs/
- The `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- `wasm-bindgen-cli`: `cargo install wasm-bindgen-cli`
- `wasm-opt`: Clone [https://github.com/WebAssembly/binaryen](binaryen) and follow install instructions there
- NodeJS and [Yarn](https://yarnpkg.com/en/)

Once you have these tools installed, you can build the project by running the `build_all.sh` script (to create an optimized, production deployment) or `run.sh` (to start a local serve for development).
