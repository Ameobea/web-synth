# vocal-synthesis-module

the **vocal synthesis module** is a loosely organized collection of tools for performing [[vocal-synthesis]] and transforming speech/singing.

Currently, the only implemented module is a Wasm port of [[sinsy]] which supports uploading [[musicxml]] and [[htsvoice]] files and generating an output wav file in the browser as output.

I plan to add support for voice autotune and possibly other effects via the [[world-vocoder]] which has a Wasm port already in existence.  Ideally, it could be implemented in a streaming fashion where [[fundamental-frequency-estimation]] is performed in realtime on incoming speech signals, making it able to be connected to and modulated via the [[patch-network]].  However, no work or planning has started for this yet.

[//begin]: # "Autogenerated link references for markdown compatibility"
[vocal-synthesis]: vocal-synthesis "vocal synthesis"
[sinsy]: sinsy "sinsy"
[musicxml]: musicxml "MusicXML"
[htsvoice]: htsvoice "htsvoice"
[world-vocoder]: world-vocoder "world-vocoder"
[fundamental-frequency-estimation]: fundamental-frequency-estimation "fundamental-frequency-estimation"
[patch-network]: patch-network "patch-network"
[//end]: # "Autogenerated link references"
