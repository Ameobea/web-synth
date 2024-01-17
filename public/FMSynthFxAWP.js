const FRAME_SIZE = 128;
const PARAM_COUNT = 4;

class FMSynthFxAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      ...new Array(PARAM_COUNT).fill(null).map((_x, i) => ({
        name: i.toString(),
        defaultValue: 0,
        automationRate: 'a-rate',
      })),
    ];
  }

  readStringFromWasmMemory = (ptr, len) => {
    const mem = new Uint8Array(this.getWasmMemoryBuffer().buffer);
    const slice = mem.subarray(ptr, ptr + len);
    return String.fromCharCode(...slice);
  };

  handleWasmPanic = (ptr, len) => {
    const str = this.readStringFromWasmMemory(ptr, len);
    throw new Error(str);
  };

  logErr = (ptr, len) => {
    const str = this.readStringFromWasmMemory(ptr, len);
    console.error(str);
  };

  log = (ptr, len) => {
    const str = this.readStringFromWasmMemory(ptr, len);
    console.log(str);
  };

  async initWasmInstance(wasmBytes) {
    const compiledModule = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(compiledModule, {
      env: {
        log_panic: this.handleWasmPanic,
        log_err: (ptr, len) => this.logErr(ptr, len),
        log_raw: (ptr, len, _level) => this.log(ptr, len),
        debug1: (v1, v2, v3) => console.log({ v1, v2, v3 }),
        on_gate_cb: () => {
          throw new Error('Unused by FM synth fx');
        },
        on_ungate_cb: () => {
          throw new Error('Unused by FM synth fx');
        },
      },
    });

    this.ctxPtr = this.wasmInstance.exports.fm_synth_fx_create_ctx();
    this.wasmMemoryBuffer = new Float32Array(this.wasmInstance.exports.memory.buffer);
  }

  handleMessage(data) {
    switch (data.type) {
      case 'setWasmBytes': {
        this.initWasmInstance(data.wasmBytes).then(() => {
          // TODO: ADSR phase
          this.port.postMessage({ type: 'wasmInitialized' });
        });
        break;
      }
      case 'shutdown': {
        this.isShutdown = true;
        break;
      }
      case 'setEffect': {
        const { encodedEffect, effectIx, isBypassed } = data;
        this.wasmInstance.exports.fm_synth_fx_set_effect(
          this.ctxPtr,
          effectIx,
          encodedEffect[0],
          encodedEffect[1]?.valueType ?? 0,
          encodedEffect[1]?.valParamInt ?? 0,
          encodedEffect[1]?.valParamFloat ?? 0,
          encodedEffect[1]?.valParamFloat2 ?? 0,
          encodedEffect[1]?.valParamFloat3 ?? 0,
          encodedEffect[2]?.valueType ?? 0,
          encodedEffect[2]?.valParamInt ?? 0,
          encodedEffect[2]?.valParamFloat ?? 0,
          encodedEffect[2]?.valParamFloat2 ?? 0,
          encodedEffect[2]?.valParamFloat3 ?? 0,
          encodedEffect[3]?.valueType ?? 0,
          encodedEffect[3]?.valParamInt ?? 0,
          encodedEffect[3]?.valParamFloat ?? 0,
          encodedEffect[3]?.valParamFloat2 ?? 0,
          encodedEffect[3]?.valParamFloat3 ?? 0,
          encodedEffect[4]?.valueType ?? 0,
          encodedEffect[4]?.valParamInt ?? 0,
          encodedEffect[4]?.valParamFloat ?? 0,
          encodedEffect[4]?.valParamFloat2 ?? 0,
          encodedEffect[4]?.valParamFloat3 ?? 0,
          isBypassed
        );
        break;
      }
      default: {
        console.error('Unhandled message type in FM synth FX AWP: ', evt.data.type);
      }
    }
  }

  constructor() {
    super();

    this.isShutdown = false;
    this.ctxPtr = 0;
    this.port.onmessage = evt => this.handleMessage(evt.data);
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
    const output = outputs[0]?.[0];

    if (this.isShutdown) {
      return false;
    } else if (!this.ctxPtr || !input || !output) {
      return true;
    }

    const ioBufPtr = this.wasmInstance.exports.fm_synth_fx_get_io_buf_ptr(this.ctxPtr);
    const ioBuf = new Float32Array(this.wasmInstance.exports.memory.buffer, ioBufPtr, FRAME_SIZE);
    ioBuf.set(input);

    const paramsBufPtr = this.wasmInstance.exports.fm_synth_fx_get_params_buf_ptr(this.ctxPtr);
    const paramsBuf = new Float32Array(
      this.wasmInstance.exports.memory.buffer,
      paramsBufPtr,
      PARAM_COUNT * FRAME_SIZE
    );
    for (let paramIx = 0; paramIx < PARAM_COUNT; paramIx += 1) {
      const param = params[paramIx.toString()];
      if (param.length === 1) {
        paramsBuf.fill(param[0], paramIx * FRAME_SIZE, (paramIx + 1) * FRAME_SIZE);
      } else {
        paramsBuf.set(param, paramIx * FRAME_SIZE);
      }
    }

    this.wasmInstance.exports.fm_synth_fx_process(this.ctxPtr);

    output.set(ioBuf);

    return true;
  }
}

registerProcessor('fm-synth-fx-awp', FMSynthFxAWP);
