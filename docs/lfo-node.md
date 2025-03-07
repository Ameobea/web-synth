# lfo-node

The **lfo node** is a [[patch-network]] node in web synth that can be created via the [[graph-editor]].  LFO stands for low-frequency oscillator, and that's just what it does.  It outputs values in the range of [-1, 1] in various selectable patterns.  It is useful for varying params of different [[module]]s.

 You'll usually want to use the LFO node in combination with a [[scale-and-shift]] node to map its output into the range needed by a destination parameter.  This is contrary to the way that modular synthesizers work, where CV is standardized into volts-per-octave or something similar.

[//begin]: # "Autogenerated link references for markdown compatibility"
[patch-network]: patch-network "patch-network"
[graph-editor]: graph-editor "graph editor"
[module]: module "web synth modules"
[scale-and-shift]: scale-and-shift "scale and shift"
[//end]: # "Autogenerated link references"
