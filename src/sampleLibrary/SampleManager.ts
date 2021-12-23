import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';

const buildSampleKey = ({ isLocal, name }: SampleDescriptor): string =>
  `${isLocal ? 'local' : 'remote'}-${name}`;

export default class SampleManager {
  private samples: Map<string, AudioBuffer> = new Map();

  public setSample(descriptor: SampleDescriptor, buffer: AudioBuffer) {
    this.samples.set(buildSampleKey(descriptor), buffer);
  }

  public getSample(descriptor: SampleDescriptor): AudioBuffer | undefined {
    return this.samples.get(buildSampleKey(descriptor));
  }
}
