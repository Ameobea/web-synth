# WaveRNN

**WaveRNN** is a single-layer recurrent neural network for audio generation that is designed efficiently predict 16-bit raw audio samples.

Link: <https://paperswithcode.com/method/wavernn>

Archive Link: <https://web.archive.org/web/20210719062406/https://paperswithcode.com/method/wavernn>

Research Paper: <https://arxiv.org/pdf/1802.08435v2.pdf>

It seems to be quite lightweight and simple, and is optimized for efficient inferrence.  It shares several similarities with libraries such as [[lpcnet]] and [[rnnoise]] including the use of [[GRU]]s and storing weights as 8-bit integers to reduce model size.

That being said, according to the research paper, it matches the performance of [[wavenet]] (I'm not sure what metrics they used for comparision though).  It's also quite recent with the original paper being released in 2018.

[//begin]: # "Autogenerated link references for markdown compatibility"
[lpcnet]: lpcnet "LPCNet"
[rnnoise]: rnnoise "rnnoise"
[GRU]: gru "GRU"
[wavenet]: wavenet "wavenet"
[//end]: # "Autogenerated link references"
