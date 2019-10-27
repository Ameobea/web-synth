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

/**
 * This is a custom node type that we use to facilitate initializing the patch network and everything else synchronously while also having
 * to asynchronously initialize the mic stream due to user permissions dialog etc.
 *
 * This node will always exist staticly, and then we asynchronously initialize the mic media stream and connect it to this.
 */
export class MicNode extends GainNode {}

export const micNode = new MicNode(ctx);

getMicrophoneStream().then(stream => ctx.createMediaStreamSource(stream).connect(micNode));
