# envelope-generator-node

The **envelope generator node** is a [[graph-editor]] node which allows for a signal to be produced when an incoming MIDI signal is received.  It uses the same UI and method of action as the [[envelope-generator]] used within the [[synth-designer]] and elsewhere.

This node is useful for setting up [[modulation]] of parameters that aligns with notes being played or for building custom synthesizers or other instruments manually.  For an example of this, see this composition which creates a playable instrument using the [[granular-synthesizer]]: <https://synth.ameo.dev/composition/88>

![A screenshot of the web synth graph editor showing the small view for configuring an envelope generator node.  The small view contains an envelope generator UI showing the curve of the envelope that is generated when a note is played.](https://i.ameo.link/cr1.png)

The envelope generator is monophonic.  This means that only a single value is output from the node at any given time no matter how many input MIDI signals are received or how many of those notes overlap.

The behavior for this node when multiple signals are received can be controlled using the "regate mode" dropdown in the UI:

![A screenshot of the "regate mode" menu within the envelope generator node small view UI](https://i.ameo.link/cr2.png)

 * **on any attack** causes the envelope to be re-gated and start again any time a new midi key down event is received by the node
 * **when no notes are currently held** causes the envelope to continue progressing without interruption until all held notes are released

[//begin]: # "Autogenerated link references for markdown compatibility"
[graph-editor]: graph-editor "graph editor"
[envelope-generator]: envelope-generator "envelope generator"
[synth-designer]: synth-designer "synth designer"
[modulation]: modulation "modulation"
[granular-synthesizer]: granular-synthesizer "granular-synthesizer"
[//end]: # "Autogenerated link references"
