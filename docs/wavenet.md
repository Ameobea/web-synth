# wavenet

**Wavenet** is a generative neural network that has the purpose of generating audio (specifically speech, but can also be used to generate arbitrary audio such as musical instruments as well) sample by sample.

One interesting thing I've noticed about Wavenet is that the training data doesn't need to be timed at the phoneme level like [[hts]].  All of the training data consists of small WAV files with transcribed text.  The transcribed text has no timing info or annotations other than just the words themselves.  It's possible that there is some pre-processing step that converts them into phonemes or some other kind of translation, but I also wouldn't be entirely surprised if that isn't the case.  In a demo they showed, the model is capable of learning different pronunciations based off of word position and context in the sentence.

## links

* Github repo with Tensorflow implementation: <https://github.com/ibab/tensorflow-wavenet>
* Research paper: <https://arxiv.org/pdf/1609.03499.pdf>
* Very understandable overview from Deepmind, includes audio demos: <https://deepmind.com/blog/article/wavenet-generative-model-raw-audio>

## supplemental libraries

* [[tacotron-2]]: An expansion on WaveNet that uses neural networks to implement the full pipeline from input text to output waveforms.  Input text is processed by a neural network to produce [[mel-spectrogram]]s that are then fed to Wavenet to produce output waveforms. [1]
* WaveGlow: Another expansion on WaveNet

Here's an official NVIDIA publication going over the architectures of both Tacotron 2 and WaveGlow, showing setup procedures for them, and comparing performance: <https://ngc.nvidia.com/catalog/resources/nvidia:tacotron_2_and_waveglow_for_pytorch/performance>

----

[1] <https://wiki.aalto.fi/display/ITSP/Statistical+parametric+speech+synthesis>

[//begin]: # "Autogenerated link references for markdown compatibility"
[hts]: hts "HTS"
[tacotron-2]: tacotron-2 "tacotron-2"
[mel-spectrogram]: mel-spectrogram "mel-spectrogram"
[//end]: # "Autogenerated link references"