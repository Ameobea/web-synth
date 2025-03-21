# wavetable synthesizer

The **wavetable synthesizer** is a component of the [[synth-designer]] to support [[wavetable]] synthesis.

To enable wavetable mode for an [[operator]], first select the operator in the [[modulation-matrix]] and then change the operator type to "wavetable" using the dropdown:

![A screenshot of the web synth synth designer UI showing the menu for swapping the operator type to wavetable, called out with a yellow arrow](https://i.ameo.link/cqz.png)

Once wavetable mode is selected, an additional step is required to actually select a wavetable to be used.  This can be done by clicking the "configure wavetable" button in the operator config menu, which brings up the wavetable preset picker and [[wavetable-editor]].

Operators in wavetable mode have the full feature set of other operator types.  They can modulate/be modulated by other operators via [[fm-synthesis]], use unison, have effects applied to their output, etc.

However, note that wavetable synthesis is more computationally expensive than other more basic synthesis types.  As a result, using wavetable synthesis with many voices of unison can result in lag or audio artifacts during playback (usually only if you're also playing many notes at the same time as well).

[//begin]: # "Autogenerated link references for markdown compatibility"
[synth-designer]: synth-designer "synth designer"
[wavetable]: wavetable "wavetable"
[operator]: operator "operator"
[modulation-matrix]: modulation-matrix "modulation matrix"
[wavetable-editor]: wavetable-editor "wavetable-editor"
[fm-synthesis]: fm-synthesis "fm-synthesis"
[//end]: # "Autogenerated link references"
