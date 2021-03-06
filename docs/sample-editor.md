# sample-editor

The **sample editor** is currently a rather abstract idea for sample manipulation, compositing, recording, and transformation functionalites for the platform.  The initial plan is to add capabilities to the [[midi-editor]] for notes to be samples in addition to MIDI notes.  Playback is implemented via an [[audio-worklet-processor]] that schedules and plays back samples according to timings from the [[global-beat-counter]].

There is a legacy sample recorder built into the [[granular-synthesizer]], but plans are to remove it from there and make it a part of the sample recorder module.  It's possible that it will end up getting wrapped with a dedicated [[patch-network]] node as well for simple recording + export use cases.

As of the time of writing this, the sample editor is still not really in existence.  It's possible that it will take on some other form later.

[//begin]: # "Autogenerated link references for markdown compatibility"
[midi-editor]: midi-editor "midi-editor"
[audio-worklet-processor]: audio-worklet-processor "audio-worklet-processor"
[global-beat-counter]: global-beat-counter "global-beat-counter"
[granular-synthesizer]: granular-synthesizer "granular-synthesizer"
[patch-network]: patch-network "patch-network"
[//end]: # "Autogenerated link references"
