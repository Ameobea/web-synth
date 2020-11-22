# Web Synth and Digial Audio Workstation

Live version updated automatically via continuous deployment: https://notes.ameo.design/

This is a web-based DAW (Digital Audio Workstation) written in Rust/WebAssembly and TypeScript. Its goal is to provide tools for creating unique sounds and audio compositions within the context of the web browser. It makes use of the latest modern WebAudio API with `AudioWorkletProcessor` for executing custom DSP code written in WebAssembly.

This project is still in very active development. At the time of writing this, a lot of functionality has been completed and it's possible to actually do interesting things with it! There are many bugs and rough edges, and much of the UI has very little polish or documentation. That being said, it's absolutely a functional tool and getting more usable + useful all the time!

## Using the Tool

Live latest version: https://notes.ameo.design/

Google Chrome is highly recommended. Although other browsers (Firefox + Safari) technically support the WebAudio APIs that this tool makes use of, I've found their support to be spotty. There are also some other bleeding-edge web APIs (WebMIDI and Native Filesystem) that the tool makes use of for some features which are, at this time, only supported in Google Chrome. Last I tried, the app loads and runs in the latest Firefox for the most part though.

I currently have no documentation or tutorials or anything for helping people learn and make use of this tool. Once I get things into a more cohesive state, I will spend the time to build that.

For some demos of what this tool can do, check out these videos:

- https://twitter.com/Ameobea10/status/1330014698125754368?s=20
- https://twitter.com/Ameobea10/status/1325234292151119873?s=20

## Building + Installing from Scratch

You'll need a few pieces of software in order to build and run this locally. They're mainly for compiling, transforming, and optimizing the WebAssembly blobs that are created as output for the Rust application.

You must have several tools installed in order to build this tool for development:

- The Rust programming language (nightly version): https://rustup.rs/
- The `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- `wasm-bindgen-cli`: `cargo install wasm-bindgen-cli`
- `wasm-opt`: Clone [https://github.com/WebAssembly/binaryen](binaryen) and follow install instructions there
- NodeJS and [Yarn](https://yarnpkg.com/en/)
- The Just command runner: `cargo install just`
- If you want Faust code support, you'll need to install `go`
- If you want to run the Web API backend which handles presets, composition sharing, and a few other things like that, you'll need to stand up a MySQL database and install the Diesel ORM command line (`cargo install diesel-cli --features=mysql`).

Once you have these tools installed, you can build the project by running `just build-all` (to create an optimized, production deployment) or `just run` (to start a local webserver on port 9000 for development that automatically hot-reloads when the JS/TS code is changed).

## Design + Structure

The tool is built on top of the WebAudio API and makes use of it for all audio processing. The WebAudio graph is the backbone of everything and the every piece of audio-processing code exists as a node within it. These nodes are created as different modules within the application and can be connected together using a built-in graph editor. The tool's engine has support for handling de/initialization of nodes, resolving connections, handling input/output shapes changing, and de/serializing on page un/load.

Speaking of that, the whole application state is serialized to the browser's local storage every time the tab is closed and automatically re-loaded when the tab is opened back up again. Saving and loading is as simple as just creating or loading a JSON blob representing the state of `localStorage`. The goal (which is mostly but not completely realized) is that refreshing the page should bring you back to the exact state you were in before automatically with no user intervention required.

### Notable Features

Note that these features may not be 100% complete or functional, but they all exist in some form.

- Runs 100% in the web browser with no installation, signup, or registration required. 100% free and open source
- Extensive [Faust language](https://faust.grame.fr/) integration with dynamic remote code compilation and executing via WebAssembly. Complete with auto-generated UIs and full integration/connectability with the rest of the tool's modules
- (Very rough/WIP) MIDI editor with support for playback and looping that outputs MIDI events directly to other modules
- Synth Designer built on top of native WebAudio oscillators + filters plus custom synthesis methods, preset sharing, and oscilloscope
- Live audio spectrum visualizations
- Graph editor/virtual patch bay allowing a top-down view of all modules and their connections with utility nodes like LFOs, signal scale+shifters (like attenuverters but way better), envelope generators, and much more
- Sequencer with support for emitting MIDI events or playing samples
- Sample library that supports loading/saving samples from local disk directly via the experimental Native Filesystem API and caching them in IndexedDB
- Granular synthesizer with waveform viewer
- Built-in support for MIDI keyboards via the WebMIDI API (currently Google Chrome only)
- Support for creating custom UIs with controls connected to any inputs in the application

### Planned Features

- Better composition, preset, etc. sharing with some basic user accounts with cloud-based sharing and forking of other users' creations
- Multi-threaded audio rendering using `SharedArrayBuffer` and web workers
- Support for more pre-built synthesis methods like FM, Karplus-Strong, wavetable, etc. directly in the synth designer
- Track compositor for laying out and sequencing MIDI, samples, signals, etc. over time and playing back
- Rendering output to audio files
- Global tempo/clock sync with integration into applicable modules
- Faust polyphonic support
- Support for user-created modules plugins with a modular loading system
- Docs, tutorials, examples
- UX improvements (always)
