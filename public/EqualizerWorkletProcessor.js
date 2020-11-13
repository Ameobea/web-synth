const KNOB_COUNT = 16;
const LEVEL_COUNT = 20;
/**
 * Defines the y level percentage at which the equalizer will be +0.
 */
const ZERO_LEVEL = 0.65;

const valueToDb = value => value * 70 - ZERO_LEVEL * 70;

const importObject = {
  env: {
    memoryBase: 0,
    tableBase: 0,
    _abs: Math.abs,

    // Float version
    _acosf: Math.acos,
    _asinf: Math.asin,
    _atanf: Math.atan,
    _atan2f: Math.atan2,
    _ceilf: Math.ceil,
    _cosf: Math.cos,
    _expf: Math.exp,
    _floorf: Math.floor,
    _fmodf: (x, y) => x % y,
    _logf: Math.log,
    _log10f: Math.log10,
    _max_f: Math.max,
    _min_f: Math.min,
    _remainderf: (x, y) => x - Math.round(x / y) * y,
    _powf: Math.pow,
    _roundf: Math.fround,
    _sinf: Math.sin,
    _sqrtf: Math.sqrt,
    _tanf: Math.tan,
    _acoshf: Math.acosh,
    _asinhf: Math.asinh,
    _atanhf: Math.atanh,
    _coshf: Math.cosh,
    _sinhf: Math.sinh,
    _tanhf: Math.tanh,

    // Double version
    _acos: Math.acos,
    _asin: Math.asin,
    _atan: Math.atan,
    _atan2: Math.atan2,
    _ceil: Math.ceil,
    _cos: Math.cos,
    _exp: Math.exp,
    _floor: Math.floor,
    _fmod: (x, y) => x % y,
    _log: Math.log,
    _log10: Math.log10,
    _max_: Math.max,
    _min_: Math.min,
    _remainder: (x, y) => x - Math.round(x / y) * y,
    _pow: Math.pow,
    _round: Math.fround,
    _sin: Math.sin,
    _sqrt: Math.sqrt,
    _tan: Math.tan,
    _acosh: Math.acosh,
    _asinh: Math.asinh,
    _atanh: Math.atanh,
    _cosh: Math.cosh,
    _sinh: Math.sinh,
    _tanh: Math.tanh,

    table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
  },
};

const heap2Str = buf => {
  let str = '';
  let i = 0;

  while (buf[i] !== 0) {
    str += String.fromCharCode(buf[i++]);
  }

  return str;
};

const clamp = (min, max, val) => Math.min(Math.max(min, val), max);

const BUFFER_SIZE = 128; // TODO: Figure out what the optimal value for this is
const SAMPLE_RATE = 44100;
const POINTER_SIZE = 4;
const SAMPLE_SIZE = 4;

class EqualizerWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const descriptors = [
      {
        name: 'input',
        defaultValue: 0,
        automationRate: 'a-rate',
      },
      {
        name: 'bypass',
        deafultValue: 0,
        automationRate: 'k-rate',
      },
      {
        name: 'smooth factor',
        defaultValue: 0.0,
        automationRate: 'k-rate',
      },
    ];

    for (let i = 0; i < KNOB_COUNT; i++) {
      if (i !== 0) {
        descriptors.push({
          name: `knob_${i}_x`,
          defaultValue: -0.00001,
          automationRate: 'k-rate',
        });
      }
      descriptors.push({
        name: `knob_${i}_y`,
        defaultValue: -0.00001,
        automationRate: 'k-rate',
      });
    }

    return descriptors;
  }

  constructor() {
    super();

    this.dspInChannels = [];
    this.dspOutChannels = [];

    this.dsp = 0;
    this.outs = null;
    this.isShutdown = false;

    this.pathTable = [];

    this.sortedParams = new Array(KNOB_COUNT);
    for (let i = 0; i < KNOB_COUNT; i++) {
      this.sortedParams[i] = { x: -1, y: -1 };
    }

    this.initWithModule = async dspInstanceArrayBuffer => {
      await this.initDspInstance(dspInstanceArrayBuffer);
      this.HEAPU8 = new Uint8Array(this.dspInstance.exports.memory.buffer);
      this.jsonDef = JSON.parse(heap2Str(this.HEAPU8));
      this.audioHeapPtr = parseInt(this.jsonDef.size, 10);
      this.numberOfInputs = parseInt(this.jsonDef.inputs, 10);
      this.numberOfOutputs = parseInt(this.jsonDef.outputs, 10);
      this.HEAP = this.dspInstance.exports.memory.buffer;
      this.HEAP32 = new Int32Array(this.HEAP);
      this.HEAPF32 = new Float32Array(this.HEAP);
      this.audioHeapPtrInputs = this.audioHeapPtr;
      this.audioHeapPtrOutputs = this.audioHeapPtrInputs + this.numberOfInputs * POINTER_SIZE;
      this.audioHeapInputs = this.audioHeapPtrOutputs + this.numberOfOutputs * POINTER_SIZE;
      this.audioHeapOutputs =
        this.audioHeapInputs + this.numberOfInputs * BUFFER_SIZE * SAMPLE_SIZE;
      this.init();
    };

    this.initDspInstance = async arrayBuffer => {
      const compiledModule = await WebAssembly.compile(arrayBuffer);
      this.dspInstance = new WebAssembly.Instance(compiledModule, importObject);
    };

    this.init = () => {
      if (this.numberOfInputs > 0) {
        const ins = this.audioHeapPtrInputs;

        for (let i = 0; i < this.numberOfInputs; i++) {
          this.HEAP32[(ins >> 2) + i] = this.audioHeapInputs + BUFFER_SIZE * SAMPLE_SIZE * i;
        } // Prepare Ins buffer tables

        const dspInChans = this.HEAP32.subarray(
          ins >> 2,
          (ins + this.numberOfInputs * POINTER_SIZE) >> 2
        );

        for (let i = 0; i < this.numberOfInputs; i++) {
          this.dspInChannels[i] = this.HEAPF32.subarray(
            dspInChans[i] >> 2,
            (dspInChans[i] + BUFFER_SIZE * SAMPLE_SIZE) >> 2
          );
        }
      }

      if (this.numberOfOutputs) {
        this.outs = this.audioHeapPtrOutputs;

        for (let i = 0; i < this.numberOfOutputs; i++) {
          this.HEAP32[(this.outs >> 2) + i] = this.audioHeapOutputs + BUFFER_SIZE * SAMPLE_SIZE * i;
        }

        // Prepare Out buffer tables
        const dspOutChans = this.HEAP32.subarray(
          this.outs >> 2,
          (this.outs + this.numberOfOutputs * POINTER_SIZE) >> 2
        );

        for (let i = 0; i < this.numberOfOutputs; i++) {
          this.dspOutChannels[i] = this.HEAPF32.subarray(
            dspOutChans[i] >> 2,
            (dspOutChans[i] + BUFFER_SIZE * SAMPLE_SIZE) >> 2
          );
        }
      }

      this.dspInstance.exports.init(this.dsp, SAMPLE_RATE);
    };

    this.bandParamOffsersByIx = new Uint32Array(LEVEL_COUNT);
    this.knobXParamNames = new Array(LEVEL_COUNT).fill('');
    this.knobYParamNames = new Array(LEVEL_COUNT).fill('');
    for (let i = 0; i < LEVEL_COUNT; i++) {
      this.bandParamOffsersByIx[i] = this.pathTable[
        `/faust-code404805250/Band${i < 10 ? '_' : ''}${i + 1}`
      ];
      this.knobXParamNames[i] = `knob_${i}_x`;
      this.knobYParamNames[i] = `knob_${i}_y`;
    }

    this.port.onmessage = async event => {
      switch (event.data.type) {
        case 'setPathTable': {
          this.pathTable = event.data.pathTable;
          break;
        }
        case 'init': {
          await this.initWithModule(event.data.dspArrayBuffer);
          this.port.postMessage({ jsonDef: this.jsonDef });
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        default: {
          console.log(`Unhandled message type: ${event.data.type}`);
        }
      }
    };
  }

  levelsBackbuffer = new Float32Array(LEVEL_COUNT).fill(0.0);
  levels = new Float32Array(LEVEL_COUNT).fill(0.0);

  lastSentLevelsIx = 0;
  sendLevels() {
    this.port.postMessage({ levels: this.levels });
  }

  computeLevels(params) {
    const temp = this.levels;
    this.levels = this.levelsBackbuffer;
    this.levelsBackbuffer = temp;

    for (let i = 0; i < KNOB_COUNT; i++) {
      const x = params[this.knobXParamNames[i]]?.[0] ?? 0;
      if (x < 0) {
        // Value less than zero means that this knob isn't connected
        this.sortedParams[i].x = -1;
        this.sortedParams[i].y = -1;
        continue;
      }

      this.sortedParams[i].x = x;
      this.sortedParams[i].y = params[this.knobYParamNames[i]][0];
    }
    // ""...It is expected to return a negative value if first argument is less than second argument"
    this.sortedParams.sort((a, b) => {
      if (b.x < 0) {
        return -1;
      } else if (a.x < 0) {
        return 1;
      }
      return a.x - b.x;
    });

    let curStartIx = 0;
    let levelsDiffer = false;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      let endX = this.sortedParams[curStartIx + 1].x;

      const levelPos = (i + 1) / LEVEL_COUNT - 1 / LEVEL_COUNT / 2;
      while (levelPos > endX) {
        if (curStartIx >= KNOB_COUNT - 2) {
          break;
        }
        curStartIx += 1;

        endX = this.sortedParams[curStartIx + 1]?.x ?? 1.0;
        if (endX < 0) {
          break;
        }
      }

      // Compute the slope of the line between the start point and the end point
      const startX = this.sortedParams[curStartIx].x;
      const startY = this.sortedParams[curStartIx].y;
      const endY = this.sortedParams[curStartIx + 1].y;
      const slope = (endY - startY) / (endX - startX);
      const intercept = startY - slope * startX;
      const level = slope * levelPos + intercept;
      this.levels[i] = valueToDb(level);
      levelsDiffer = levelsDiffer || this.levels[i] !== this.levelsBackbuffer[i];
    }

    this.lastSentLevelsIx += 1;
    if ((levelsDiffer && this.lastSentLevelsIx >= 16) || this.lastSentLevelsIx >= 128) {
      this.lastSentLevelsIx = 0;
      this.sendLevels();
    }
  }

  process(inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.dspInstance || !this.pathTable) {
      return true;
    }

    this.computeLevels(params);

    // Set all params into the Wasm memory from the latest values we have to our `AudioParam`s
    this.levels.forEach((level, i) =>
      this.dspInstance.exports.setParamValue(
        this.dsp,
        this.bandParamOffsersByIx[i],
        clamp(-50, 20, Number.isNaN(level) ? 0 : level)
      )
    );
    // Bypass
    this.dspInstance.exports.setParamValue(this.dsp, 0, params.bypass[0]);
    // Smooth Factor
    this.dspInstance.exports.setParamValue(this.dsp, 832, params['smooth factor'][0]);

    for (let i = 0; i < Math.min(inputs.length, this.dspInChannels.length); i++) {
      // Copy inputs into the Wasm heap
      const inputChannel0 = inputs[i][0];
      const dspInput = this.dspInChannels[i];
      if (inputChannel0) {
        dspInput.set(inputChannel0);
      }
    }

    // Compute on the Faust/Wasm side
    this.dspInstance.exports.compute(
      this.dsp,
      BUFFER_SIZE,
      this.audioHeapPtrInputs,
      this.audioHeapPtrOutputs
    );

    // Copy computed outputs from the Wasm heap into the WebAudio output buffer
    for (let i = 0; i < Math.min(outputs.length, this.dspOutChannels.length); i++) {
      const dspOutput = this.dspOutChannels[i];
      for (let channelIx = 0; channelIx < outputs[i].length; channelIx++) {
        outputs[i][channelIx].set(dspOutput);
      }
    }

    return true;
  }
}

registerProcessor('equalizer-audio-worklet-node-processor', EqualizerWorkletProcessor);
