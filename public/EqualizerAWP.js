const FRAME_SIZE = 128;

// this needs to stay in sync with `EQ_MAX_AUTOMATED_PARAM_COUNT` from the UI-thread code
const EQ_MAX_AUTOMATED_PARAM_COUNT = 4;
const AutomationParamKeys = new Array(EQ_MAX_AUTOMATED_PARAM_COUNT)
  .fill(null)
  .map((_, i) => `automation_${i}`);

class EqualizerAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return new Array(EQ_MAX_AUTOMATED_PARAM_COUNT).fill(null).map((_, i) => ({
      name: AutomationParamKeys[i],
      defaultValue: 0,
      automationRate: 'a-rate',
    }));
  }

  constructor(_options) {
    super({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.wasmInstance = null;
    this.wasmMemoryBuffer = null;
    this.automationParamBuf = null;
    this.automationSAB = null;
    this.automationSABView = null;
    this.wasmSideSAB = null;
    this.isBypassed = false;

    this.port.onmessage = evt => {
      switch (evt.data.type) {
        case 'setWasmBytes': {
          this.initWasmInstance(evt.data.wasmBytes);
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        case 'setInitialState': {
          this.ctxPtr = this.wasmInstance.exports.equalizer_init();
          this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
          const {
            state: { bands },
          } = evt.data;
          for (let bandIx = 0; bandIx < bands.length; bandIx++) {
            this.commitBand(bandIx, bands[bandIx]);
          }
          const automationParamBufPtr = this.wasmInstance.exports.equalizer_get_automation_bufs_ptr(
            this.ctxPtr
          );
          this.automationParamBuf = this.wasmMemoryBuffer.subarray(
            automationParamBufPtr / Float32Array.BYTES_PER_ELEMENT,
            automationParamBufPtr / Float32Array.BYTES_PER_ELEMENT +
              FRAME_SIZE * EQ_MAX_AUTOMATED_PARAM_COUNT
          );
          if (typeof SharedArrayBuffer !== 'undefined') {
            this.automationSAB = new SharedArrayBuffer(
              Float32Array.BYTES_PER_ELEMENT * EQ_MAX_AUTOMATED_PARAM_COUNT
            );
            this.automationSABView = new Float32Array(this.automationSAB);
            this.port.postMessage({
              type: 'setAutomationSAB',
              sab: this.automationSABView,
            });
          }
          break;
        }
        case 'setState': {
          const {
            state: { bands },
          } = evt.data;
          this.wasmInstance.exports.equalizer_set_band_count(this.ctxPtr, bands.length);
          for (let bandIx = 0; bandIx < bands.length; bandIx++) {
            this.commitBand(bandIx, bands[bandIx]);
          }
          break;
        }
        case 'setBand': {
          const { bandIx, band } = evt.data;
          this.commitBand(bandIx, band);
          break;
        }
        case 'setBypassed': {
          this.isBypassed = evt.data.isBypassed;
          break;
        }
        default:
          console.error('Unknown message type in EqualizerAWP', evt.data.type);
      }
    };
  }

  commitBand(
    bandIx,
    { filterType, frequency, q, gain, freqAutomationBufIx, qAutomationBufIx, gainAutomationBufIx }
  ) {
    this.wasmInstance.exports.equalizer_set_band(
      this.ctxPtr,
      bandIx,
      filterType,
      frequency,
      q,
      gain,
      typeof freqAutomationBufIx === 'number' && freqAutomationBufIx >= 0
        ? freqAutomationBufIx
        : 99999,
      typeof qAutomationBufIx === 'number' && qAutomationBufIx >= 0 ? qAutomationBufIx : 99999,
      typeof gainAutomationBufIx === 'number' && gainAutomationBufIx >= 0
        ? gainAutomationBufIx
        : 99999
    );
  }

  logWasmErr = (ptr, len) => {
    const mem = new Uint8Array(this.wasmInstance.exports.memory.buffer);
    const slice = mem.subarray(ptr, ptr + len);
    const str = String.fromCharCode(...slice);
    console.error(str);
  };

  async initWasmInstance(wasmBytes) {
    const importObject = { env: { log_err: (ptr, len) => this.logWasmErr(ptr, len) } };
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, importObject);

    this.port.postMessage({ type: 'ready' });
  }

  getWasmMemoryBuffer() {
    if (this.wasmMemoryBuffer.buffer !== this.wasmInstance.exports.memory.buffer) {
      this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
    }
    return this.wasmMemoryBuffer;
  }

  /**
   *
   * @param {Float32Array[][]} inputs
   * @param {Float32Array[][]} outputs
   * @param {{[key: string]: Float32Array}} params
   * @returns {boolean}
   */
  process(inputs, outputs, params) {
    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }
    if (this.isShutdown) {
      console.warn('mix AWP shut down');
      return false;
    }
    if (!this.ctxPtr) {
      return true;
    }

    const wasmMemory = this.getWasmMemoryBuffer();
    const inputPtr = this.wasmInstance.exports.equalizer_get_io_buf_ptr(this.ctxPtr);
    wasmMemory.set(input, inputPtr / Float32Array.BYTES_PER_ELEMENT);

    for (let i = 0; i < AutomationParamKeys.length; i++) {
      const paramKey = AutomationParamKeys[i];
      const param = params[paramKey];
      if (param.length === 1) {
        this.automationParamBuf.fill(param[0], i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
      } else {
        this.automationParamBuf.set(param, i * FRAME_SIZE);
      }
      if (this.automationSABView) {
        this.automationSABView[i] = param[param.length - 1];
      }
    }

    if (this.isBypassed) {
      output.set(input);
    } else {
      this.wasmInstance.exports.equalizer_process(this.ctxPtr);

      output.set(
        wasmMemory.subarray(
          inputPtr / Float32Array.BYTES_PER_ELEMENT,
          inputPtr / Float32Array.BYTES_PER_ELEMENT + FRAME_SIZE
        )
      );
    }

    return true;
  }
}

registerProcessor('equalizer-awp', EqualizerAWP);
