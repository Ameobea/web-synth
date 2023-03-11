const FRAME_SIZE = 128;
const SAMPLE_RATE = 44_100;

class FaustAudioWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();

    this.faustWasmInstance = null;
    this.faustLowInputBuffer = null;
    this.faustMidInputBuffer = null;
    this.faustHighInputBuffer = null;
    this.faustOutputBuffer = null;
    this.rustWasmInstance = null;
    this.rustWasmMemoryBuffer = null;
    this.rustWasmInputBufPtr = 0;
    this.rustWasmLowOutputBufPtr = 0;
    this.rustWasmMidOutputBufPtr = 0;
    this.rustWasmHighOutputBufPtr = 0;
    this.isShutdown = false;

    this.params = {
      low: {},
      mid: {},
      high: {},
    };

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes':
          const { faustWasmBytes, rustWasmBytes, initialParams } = evt.data;
          this.initWasm(faustWasmBytes, rustWasmBytes, initialParams).catch(console.error);
          break;
        case 'setParam':
          const { band, param, value } = evt.data;
          this.params[band][param] = value;
          break;
        default:
          console.error('Unknown message type in MBDLDNodeAWP:', evt.data.type);
      }
    };
  }

  async initWasm(faustWasmBytes, rustWasmBytes, initialParams) {
    this.params = initialParams;

    const faustImportObject = { env: { _powf: Math.pow, _tanf: Math.tan } };
    const compiledFaustModule = await WebAssembly.compile(faustWasmBytes);
    this.faustWasmInstance = await WebAssembly.instantiate(compiledFaustModule, faustImportObject);
    this.faustWasmMemoryBuffer = new Float32Array(this.faustWasmInstance.exports.memory.buffer);
    const faustI32Memory = new Int32Array(this.faustWasmInstance.exports.memory.buffer);

    const audioHeapPtrInputs = 328;
    const SAMPLE_SIZE = 4;
    const POINTER_SIZE = 4;
    const numberOfInputs = 3;
    const ins = audioHeapPtrInputs;
    const numberOfOutputs = 1;
    const audioHeapInputs = 344;

    faustI32Memory[(ins >> 2) + 0] = audioHeapInputs + FRAME_SIZE * SAMPLE_SIZE * 0;
    faustI32Memory[(ins >> 2) + 1] = audioHeapInputs + FRAME_SIZE * SAMPLE_SIZE * 1;
    faustI32Memory[(ins >> 2) + 2] = audioHeapInputs + FRAME_SIZE * SAMPLE_SIZE * 2;

    const dspInChans = faustI32Memory.subarray(
      ins >> 2,
      (ins + numberOfInputs * POINTER_SIZE) >> 2
    );

    this.faustLowInputBuffer = this.faustWasmMemoryBuffer.subarray(
      dspInChans[0] >> 2,
      (dspInChans[0] + FRAME_SIZE * SAMPLE_SIZE) >> 2
    );
    this.faustMidInputBuffer = this.faustWasmMemoryBuffer.subarray(
      dspInChans[1] >> 2,
      (dspInChans[1] + FRAME_SIZE * SAMPLE_SIZE) >> 2
    );
    this.faustHighInputBuffer = this.faustWasmMemoryBuffer.subarray(
      dspInChans[2] >> 2,
      (dspInChans[2] + FRAME_SIZE * SAMPLE_SIZE) >> 2
    );

    const audioHeapPtrOutputs = 340;
    const audioHeapOutputs = 1880;
    const outs = audioHeapPtrOutputs;
    faustI32Memory[(outs >> 2) + 0] = audioHeapOutputs + FRAME_SIZE * SAMPLE_SIZE * 0;
    const dspOutChans = faustI32Memory.subarray(
      outs >> 2,
      (outs + numberOfOutputs * POINTER_SIZE) >> 2
    );
    this.faustOutputBuffer = this.faustWasmMemoryBuffer.subarray(
      dspOutChans[0] >> 2,
      (dspOutChans[0] + FRAME_SIZE * SAMPLE_SIZE) >> 2
    );

    this.faustWasmInstance.exports.init(0, SAMPLE_RATE);

    const rustImportObject = { env: {} };
    const compiledRustModule = await WebAssembly.compile(rustWasmBytes);
    this.rustWasmInstance = await WebAssembly.instantiate(compiledRustModule, rustImportObject);
    this.rustWasmInstance.exports.init();
    this.rustWasmMemoryBuffer = new Float32Array(this.rustWasmInstance.exports.memory.buffer);
    this.rustWasmInputBufPtr = this.rustWasmInstance.exports.get_input_buf_ptr();
    this.rustWasmLowOutputBufPtr = this.rustWasmInstance.exports.get_low_output_buf_ptr();
    this.rustWasmMidOutputBufPtr = this.rustWasmInstance.exports.get_mid_output_buf_ptr();
    this.rustWasmHighOutputBufPtr = this.rustWasmInstance.exports.get_high_output_buf_ptr();
  }

  getRustWasmMemoryBuffer() {
    if (this.rustWasmMemoryBuffer.buffer !== this.rustWasmInstance.exports.memory.buffer) {
      this.rustWasmMemoryBuffer = new Float32Array(this.rustWasmInstance.exports.memory.buffer);
    }
    return this.rustWasmMemoryBuffer;
  }

  process(inputs, outputs, _params) {
    if (this.isShutdown) {
      return false;
    }
    if (!this.faustWasmInstance || !this.rustWasmInstance) {
      return true;
    }

    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) {
      return true;
    }

    const rustWasmMemoryBuffer = this.getRustWasmMemoryBuffer();
    rustWasmMemoryBuffer.set(input, this.rustWasmInputBufPtr / 4);
    this.rustWasmInstance.exports.process();

    // Copy Rust output to Faust inputs
    this.faustLowInputBuffer.set(
      rustWasmMemoryBuffer.subarray(
        this.rustWasmLowOutputBufPtr / 4,
        this.rustWasmLowOutputBufPtr / 4 + FRAME_SIZE
      )
    );
    this.faustMidInputBuffer.set(
      rustWasmMemoryBuffer.subarray(
        this.rustWasmMidOutputBufPtr / 4,
        this.rustWasmMidOutputBufPtr / 4 + FRAME_SIZE
      )
    );
    this.faustHighInputBuffer.set(
      rustWasmMemoryBuffer.subarray(
        this.rustWasmHighOutputBufPtr / 4,
        this.rustWasmHighOutputBufPtr / 4 + FRAME_SIZE
      )
    );

    // const pathTable = {
    //   '/faust-code424840848/Q_high': 64,
    //   '/faust-code424840848/Q_low': 272,
    //   '/faust-code424840848/Q_mid': 168,
    //   '/faust-code424840848/dry_high': 24,
    //   '/faust-code424840848/dry_low': 236,
    //   '/faust-code424840848/dry_mid': 132,
    //   '/faust-code424840848/normalized_frequency_high': 48,
    //   '/faust-code424840848/normalized_frequency_low': 260,
    //   '/faust-code424840848/normalized_frequency_mid': 156,
    //   '/faust-code424840848/post_gain_high': 12,
    //   '/faust-code424840848/post_gain_low': 224,
    //   '/faust-code424840848/post_gain_mid': 120,
    //   '/faust-code424840848/pre_gain_high': 76,
    //   '/faust-code424840848/pre_gain_low': 284,
    //   '/faust-code424840848/pre_gain_mid': 180,
    //   '/faust-code424840848/wet_high': 36,
    //   '/faust-code424840848/wet_low': 248,
    //   '/faust-code424840848/wet_mid': 144,
    // };
    this.faustWasmInstance.exports.setParamValue(0, 284, this.params.low.preGain);
    this.faustWasmInstance.exports.setParamValue(0, 224, this.params.low.postGain);
    this.faustWasmInstance.exports.setParamValue(0, 272, this.params.low.Q);
    this.faustWasmInstance.exports.setParamValue(0, 260, this.params.low.normalizedFrequency);
    this.faustWasmInstance.exports.setParamValue(0, 248, this.params.low.wet);
    this.faustWasmInstance.exports.setParamValue(0, 236, this.params.low.dry);

    this.faustWasmInstance.exports.setParamValue(0, 180, this.params.mid.preGain);
    this.faustWasmInstance.exports.setParamValue(0, 120, this.params.mid.postGain);
    this.faustWasmInstance.exports.setParamValue(0, 168, this.params.mid.Q);
    this.faustWasmInstance.exports.setParamValue(0, 156, this.params.mid.normalizedFrequency);
    this.faustWasmInstance.exports.setParamValue(0, 144, this.params.mid.wet);
    this.faustWasmInstance.exports.setParamValue(0, 132, this.params.mid.dry);

    this.faustWasmInstance.exports.setParamValue(0, 76, this.params.high.preGain);
    this.faustWasmInstance.exports.setParamValue(0, 12, this.params.high.postGain);
    this.faustWasmInstance.exports.setParamValue(0, 64, this.params.high.Q);
    this.faustWasmInstance.exports.setParamValue(0, 48, this.params.high.normalizedFrequency);
    this.faustWasmInstance.exports.setParamValue(0, 36, this.params.high.wet);
    this.faustWasmInstance.exports.setParamValue(0, 24, this.params.high.dry);

    this.faustWasmInstance.exports.compute(0, 128, 328, 340);

    output.set(this.faustOutputBuffer);

    return true;
  }
}

registerProcessor('multiband-diode-ladder-distortion-awp', FaustAudioWorkletProcessor);
