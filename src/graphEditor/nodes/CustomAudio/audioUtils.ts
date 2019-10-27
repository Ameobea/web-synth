const ctx = new AudioContext();

export const decodeAudioData = (
  audioDataFileContent: ArrayBuffer
): Promise<AudioBufferSourceNode> =>
  new Promise((resolve, reject) =>
    ctx.decodeAudioData(
      audioDataFileContent,
      decodedAudioData => {
        const audioBufferSource = ctx.createBufferSource();
        audioBufferSource.buffer = decodedAudioData;
        resolve(audioBufferSource);
      },
      err => reject(`Error decoding provided audio file: ${err}`)
    )
  );

export const getMicrophoneStream = (): Promise<MediaStream> =>
  new Promise((fulfill, reject) => {
    if (navigator.getUserMedia) {
      navigator.getUserMedia({ audio: true }, fulfill, reject);
    } else {
      fulfill(navigator.mediaDevices.getUserMedia({ audio: true }));
    }
  });

export let micNode: MediaStreamAudioSourceNode;

getMicrophoneStream().then(stream => {
  micNode = ctx.createMediaStreamSource(stream);
});
