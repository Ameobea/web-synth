const SAMPLES_PER_FRAME = 128;

class StatisticsNodeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'input',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
    ];
  }

  /**
   * How many frames to record before building a histogram and sending the stats back to the UI thread
   */
  framesToSample = 43;
  /**
   * Total number of valid entries in `this.samples` that should be used when computing histogram
   */
  sampleCount = 0;
  /**
   * Number of buckets to include in the computed histogram
   */
  bucketCount = 128;
  /**
   * The array of sampled values from the `input` `AudioParam`
   */
  samples = new Float32Array(this.framesToSample * SAMPLES_PER_FRAME);
  /**
   * The minimum seen value of the sampled `input` `AudioParam`
   */
  minSample = Number.MAX_VALUE;
  /**
   * The maximum seen value of the sampled `input` `AudioParam`
   */
  maxSample = -Number.MAX_VALUE;
  /**
   * Number of buffers that have been processed since last reporting stats
   */
  framesSinceLastReport = 0;

  buildHistogram() {
    let range = this.maxSample - this.minSample;
    if (range === 0) {
      range = this.minSample === 0 ? this.minSample : 1;
    }

    const buckets = [];
    for (let i = 0; i < this.bucketCount; i++) {
      buckets[i] = 0;
    }

    const normalizedBucketSize = 1 / this.bucketCount;
    for (let i = 0; i < this.sampleCount; i++) {
      const sample = this.samples[i];
      // Normalize sample from the [minSample, maxSample] range to [0, 1]
      const normalizedSample = (sample - this.minSample) / range;
      // Now convert to the range [0, bucketCount]
      const bucketIx = Math.floor(normalizedSample / normalizedBucketSize);
      buckets[bucketIx] += 1;
    }

    return { min: this.minSample, max: this.maxSample, buckets };
  }

  reportStats() {
    const stats = this.buildHistogram();
    this.port.postMessage(stats);

    this.resetCounters();
  }

  resetCounters() {
    this.sampleCount = 0;
    this.minSample = Number.MAX_VALUE;
    this.maxSample = -Number.MAX_VALUE;
    this.framesSinceLastReport = 0;
  }

  process(_inputs, _outputs, params) {
    for (let i = 0; i < params.input.length; i++) {
      const sample = params.input[i];
      if (sample < this.minSample) {
        this.minSample = sample;
      }
      if (sample > this.maxSample) {
        this.maxSample = sample;
      }

      this.samples[this.sampleCount + i] = sample;
    }
    this.sampleCount += params.input.length;

    this.framesSinceLastReport += 1;
    if (this.framesSinceLastReport === this.framesToSample) {
      this.reportStats();
      this.resetCounters();
    }

    return true;
  }
}

registerProcessor('statistics-node-processor', StatisticsNodeProcessor);
