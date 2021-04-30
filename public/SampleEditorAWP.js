const BYTES_PER_F32 = 32 / 8;

class SampleEditorAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();

    this.wasmInst = null;
    this.ctxPtr = 0;
    this.wasmMemoryF32View = new Float32Array();
    /**
     * Mapping from sample data ID to index in the sample data storage in Wasm memory
     */
    this.sampleDataMapping = new Map();
    /**
     * Mapping from sample ID to the key of the sample in Wasm memory that can be used to remove it.
     */
    this.sampleKeyMapping = new Map();

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'init': {
          this.initWasm(evt.data.wasmBytes, evt.data.sampleData, evt.data.initialSamples);
          break;
        }
        case 'createSample': {
          this.createSample(evt.data.sample);
          break;
        }
        case 'removeSample': {
          this.removeSample(evt.data.sampleID);
          break;
        }
        default: {
          console.warn('Unhandled event type received over port: ' + evt.data.type);
        }
      }
    };
  }

  /**
   * Writes the provided `sampleData` into the sample data buffer in Wasm memory and returns the index
   * in the array that it was written.
   *
   * @param {{id: string|number; samples: Float32Array}} sampleData
   * @returns {number} the index in the sample data arra in Wasm memory into which the sample data was written
   */
  setSampleData(sampleData) {
    let index = this.sampleDataMapping.get(sampleData.id) ?? -1;
    index = this.wasmInst.exports.write_sample_data(this.ctxPtr, sampleData.samples.length, index);
    const sampleDataBufPtr = this.wasmInst.exports.get_sample_data_buf_ptr(this.ctxPtr, index);
    const f32Index = sampleDataBufPtr / BYTES_PER_F32;
    this.wasmMemoryF32View.set(sampleData.samples, f32Index);
    return index;
  }

  /**
   * Schedules a sample in the Wasm.  The sample's data must have already been written into Wasm
   * memory with the `setSampleData` function.
   *
   * @param {{ id: string|number; startBeat: number }} sample
   */
  createSample(sample) {
    const dataIndex = this.sampleDataMapping.get(sample.id);
    if (dataIndex === undefined || dataIndex === null) {
      throw new Error(
        `Sample id=${sample.id} hasn't had its data set, but was passed to \`createSample\`.`
      );
    }

    // TODO: Gain envelopes
    const key = this.wasmInst.exports.create_sample(
      this.ctxPtr,
      sample.startBeat,
      dataIndex,
      false
    );
    this.sampleKeyMapping.set(sample.id, key);
  }

  /**
   * Removes the scheduled sample with the provided ID.  Does not delete the sample data that it references.
   *
   * @param {string|number} sampleID
   */
  removeSample(sampleID) {
    const key = this.sampleKeyMapping.get(sampleID);
    if (key === null || key === undefined) {
      throw new Error(
        `Tried to remove sample with id=${sampleID} but no entry exists for it in \`sampleKeyMapping\`.`
      );
    }

    this.wasmInst.exports.remove_sample(this.ctxPtr, key);
    this.sampleKeyMapping.delete(sampleID);
  }

  async initWasm(wasmBytes, sampleData, initialSamples) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInst = new WebAssembly.Instance(compiledModule, importObject);
    this.ctxPtr = this.wasmInst.exports.init_sample_editor_ctx();
    this.wasmMemoryF32View = new Float32Array(this.wasmInst.exports.memory.buffer);

    // Copy the actual sample data into Wasm memory
    sampleData.forEach(datum => this.setSampleData(datum));

    // Create samples referencing the stored sample data for all samples to be scheduled/played
    initialSamples.forEach(sample => this.createSample(sample));
  }

  process(_inputs, _outputs, _params) {
    if (!this.wasmInst) {
      return true;
    }

    this.wasmInst.exports.process_sample_editor(this.ctxPtr, globalThis.curBeat);

    return true;
  }
}

registerProcessor('sample-editor-awp', SampleEditorAWP);
