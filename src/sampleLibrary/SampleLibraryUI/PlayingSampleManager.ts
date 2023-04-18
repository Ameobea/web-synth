import { getSample, type SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';

const ctx = new AudioContext();

const buildSampleBufferSourceNode = async (
  descriptor: SampleDescriptor,
  onFinished: () => void
): Promise<AudioBufferSourceNode> => {
  const buffer = await getSample(descriptor);
  const bufSrc = new AudioBufferSourceNode(ctx);
  bufSrc.buffer = buffer;
  bufSrc.connect((ctx as any).globalVolume);
  bufSrc.onended = onFinished;

  return bufSrc;
};

export class PlayingSampleManager {
  private setPlayingSampleName: (name: string | null) => void;
  private playingSampleDescriptor: SampleDescriptor | null = null;
  private playingSample: AudioBufferSourceNode | null = null;

  constructor(setPlayingSampleName: (name: string | null) => void) {
    this.setPlayingSampleName = setPlayingSampleName;
  }

  private startPlaying = (desc: SampleDescriptor) => {
    this.playingSampleDescriptor = desc;
    this.setPlayingSampleName(desc.name);
    buildSampleBufferSourceNode(desc, () => {
      if (this.playingSampleDescriptor?.name === desc.name) {
        this.playingSample = null;
        this.setPlayingSampleName(null);
      }
    }).then(bufSrc => {
      // If the playing sample has changed before we fetched this, don't start playing it
      if (this.playingSampleDescriptor?.name !== desc.name) {
        return;
      }
      bufSrc.start();
      if (this.playingSample) {
        console.error('Invariant violation; playing sample buffer was set before fetch completed');
        this.playingSample.stop();
      }
      this.playingSample = bufSrc;
    });
  };

  public togglePlaying(desc: SampleDescriptor) {
    this.playingSample?.stop();
    this.playingSample = null;

    if (desc.name === this.playingSampleDescriptor?.name) {
      this.playingSampleDescriptor = null;
      return;
    }

    this.startPlaying(desc);
  }

  public dispose() {
    this.playingSample?.stop();
    this.playingSample = null;
    this.playingSampleDescriptor = null;
  }
}
