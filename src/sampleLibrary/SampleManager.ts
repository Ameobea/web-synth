import { hashSampleDescriptor, type SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';

export default class SampleManager {
  private samples: Map<string, AudioBuffer> = new Map();

  public setSample(descriptor: SampleDescriptor, buffer: AudioBuffer) {
    this.samples.set(hashSampleDescriptor(descriptor), buffer);
  }

  public getSample(descriptor: SampleDescriptor): AudioBuffer | undefined {
    return this.samples.get(hashSampleDescriptor(descriptor));
  }
}
