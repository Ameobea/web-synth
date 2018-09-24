# Sketch Template

This directory is designed to be used as a template for sketches. It contains a minimal set of scripts, config, and other boilerplate to create a WebAssembly web application with Rust, `wasm-bindgen`, and Webpack.

## Requirements

You must have several tools installed in order to use this template:

- The Rust programming language: https://rustup.rs/
- The `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- `wasm-bindgen-cli`: `cargo install wasm-bindgen-cli`
- `wasm-gc`: `cargo install wasm-gc`
- `wasm-opt`: Clone [https://github.com/WebAssembly/binaryen](binaryen) and follow install instructions there
- NodeJS and [Yarn](https://yarnpkg.com/en/)

### Docker

If you prefer, you can build sketches via docker to avoid manually installing all of the dependencies. Simply run the `docker_build_all.sh` script. Please note that the Docker image is very big (>1GB).

## Building Sketches

After you've copied the template to a new subdirectory, all you have to do to build the sketch is to install dependencies by running `yarn` in the project root followed by running the `build_all.sh` (`docker_build_all.sh` if you're using Docker) script. This will handle compiling the Rust project into WebAssembly, running `wasm-bindgen-cli` to generate TypeScript bindings, optimizing the generated Wasm binary, linking it into the frontend, and generating a static site output in the `/dist` directory. You can then serve that directory with any simple HTTP server (such as `serve` (`yarn install serve`, `serve dist`)) and view it in a web browser.

### Common Library

Please note that there is a library pulled in by the Rust part by default (`/common` in the repository root) which contains various helpers and utility functions. If you move a copied sketch out of the `/sketches` directory, it won't be able to find the library. You'll have to either tweak `engine/Cargo.toml` and supply a new path to the directory or remove it if you don't need it.

## Directory Structure

The directory is mostly split into two parts: the Rust part (`engine` directory) and the TypeScript part (`src` directory). All of the code that gets compiled into Wasm goes in the `engine/src/` directory and gets called from `src/index.ts`.

### Config Files

In addition to just the code, there are several config files you may want to edit:

- `package.json` to add new scripts, JS dependencies, change the license, set your name as the author, etc.
- `index.hbs` to edit the HTML that is generated
- `webpack.config.js`/`webpack.prod.js` to tweak the WebPack config
- `tsconfig.json`/`tslint.json` to tweak the TypeScript compiler+linter
- `LICENSE` if you'd prefer something other than the MIT license
- `.eslintrc` to tweak the Eslint config (I used my personal preferences as a default)
