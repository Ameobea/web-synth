# detune

**Detune** is a parameter that is used to offset a played note from its base frequency.  The unit for detune is **cents**; one cent is equivalent to 1/100 of a **semitone** and there are 12 semitones in an octave.

The equation for producing an output frequency from a base frequency and a detune matches that of WebAudio, taken from the WebAudio spec: <https://www.w3.org/TR/webaudio/#computedfrequency>

`computedFrequency(t) = frequency(t) * pow(2, detune(t) / 1200)`
