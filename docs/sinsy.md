# sinsy

**Sinsy** is an open source singing engine for [[vocal-synthesis]] built on top of [[HTS]].  Website: <http://www.sinsy.jp/>  It takes two pieces of input: a [[musicxml]] file containing notes and lyrics/syllables to sing and a [[HTS]] voice file (*.htsvoice).

## project status

From what I can tell, Sinsy is past its prime in terms of development attention.  It's been around for at least a decade.  However, it definitely seems to still be in development with the most recent update as of the time of writing this being in December 2020.  Although the website and cloud-based demo were updated at that time, it seems that many of the features available via the web demo are not available on the open source version available.

There is not a wealth of information available for this synthesizer.  It seems that there is a decent collection of songs on soundcloud/NND/youtube made with Sinsy, but all seem to have been made via their cloud-based demo.  I can find no active development for sinsy.  There is one library on Github called [sinsymaker](https://github.com/ceefour/sinsymaker) that is inactive for 6 years; I couldn't get it to build after some cursory attempts.  [Discussion boards](https://sourceforge.net/p/sinsy/discussion/general/) as very sparsely populated and many threads go un-answered.  It doesn't help that all of the devs seem to be native Japanese speakers but all of the discussion there is in English.  There were some mentions of porting recent updates to open source, but other mentions of issues with licensing.  Overall, I do not hold out a lot of hope for this to develop in the future in a way that I can make use of except via that web interface which is not useful to me.

TL;DR the project is pretty dry and I don't see it showing signs of coming back to life any time soon.  It's certainly possible; it's been around for years, but I'm not interested in holding out hope and waiting for that.

## wasm port

I spent some time trying to get this to run in the web browser via Emscripten + WebAssembly with much success.  Although at the time of writing this I've only just finished up an initial POC of generating a WAV file of singing voice from within the browser, the whole thing works end to end so any additional work is possible without limitation.

Given the rather dire state of the project, I plan on finishing up and integrating my minimal demo into web-synth directly. It can produce some low-quality sound using that nitech [[htsvoice]] that seems to be the only one that works even remotely well.  I plan to add support for exporting those samples into the web-synth sample library, after which point I will call it done and move on to other things.

[//begin]: # "Autogenerated link references for markdown compatibility"
[vocal-synthesis]: vocal-synthesis "vocal synthesis"
[HTS]: hts "HTS"
[musicxml]: musicxml "MusicXML"
[htsvoice]: htsvoice "htsvoice"
[//end]: # "Autogenerated link references"
