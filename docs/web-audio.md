# `WebAudio`

`WebAudio` is a browser API that provides a standard interface for defining [[audio-graph]]s and performing many different types of work on live streaming audio in a platform independent manner.  Since web synth runs completely in the web browser, it is able to take advantage of the `WebAudio` API to facilitate all of its audio generation, routing, processing, and output.

`WebAudio` is a solid foundation that allows for performant real-time generation of audio.  It accomplishes this by running audio code on a dedicated thread so that it doesn't suffer from buffer underruns or other problems caused by the main thread being taken up by UI rendering or other tasks.  In addition to providing an array of built-in audio processing primitives like filters, compressors, gain control, oscillators, and audio analyzers, it also supports the execution of comletely user-defined DSP code in that audio thread via `AudioWorkletProcessor`.  This allows DSP code written in Rust and compiled to WebAssembly be run and this technique is used for several core pieces of web synth.

[//begin]: # "Autogenerated link references for markdown compatibility"
[audio-graph]: audio-graph "audio graph"
[//end]: # "Autogenerated link references"