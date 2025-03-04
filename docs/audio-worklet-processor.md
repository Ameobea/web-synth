# audio-worklet-processor

An `AudioWorkletProcessor` (often abbreviated as AWP in web synth code and docs) is a tool from [[web-audio]] that allows running custom use-defined code directly on the audio thread.  It exposes a message-based interface for exchanging arbitrary data with the main thread as well as supporting other methods such as `SharedArrayBuffer`.

WebAssembly can also be compiled + instantiated from within the AWP, meaning that DSP code written in Rust can be compiled and run in WebAudio via AWPs.  This is the method that most of the low-level DSP code in web synth is implemented including the [[granular-synthesizer]], [[fm-synth]], [[sample-editor]], and various other components and [[module]]s.

[//begin]: # "Autogenerated link references for markdown compatibility"
[web-audio]: web-audio "web-audio"
[granular-synthesizer]: granular-synthesizer "granular-synthesizer"
[fm-synth]: fm-synth "FM Synthesizer"
[sample-editor]: sample-editor "sample-editor"
[module]: module "web synth modules"
[//end]: # "Autogenerated link references"
