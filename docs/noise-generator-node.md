# noise-generator-node

The **noise generator node** is a [[patch-network]] node that can be created by the [[graph-editor]].  Its purpose is to output random values (noise).  It supports two modes of output:

 * White noise, which is purely random values from [-1, 1] every sample and
 * Stepped random values, which is white noise which is sampled and held for a configurable number of samples

In addition, it also supports quantization and smoothing of its output.

Quantization works by snapping outputs to a configurable number of steps.  A quantization factor of 0 means no quantization.  A factor of 4 means that values will be snapped to a total of 4 different values from [-1, 1].

Smoothing applies a one-pole lowpass filter to output values with a configurable coefficient.

[//begin]: # "Autogenerated link references for markdown compatibility"
[patch-network]: patch-network "patch-network"
[graph-editor]: graph-editor "graph editor"
[//end]: # "Autogenerated link references"