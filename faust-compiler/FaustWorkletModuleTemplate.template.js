const jsonModuleDef = {{.JSONModuleDef}};

const moduleId = "{{.ModuleID}}";

const flattenUiGroups = ui =>
  ui.reduce(
    (acc, item) =>
      ['vgroup', 'hgroup'].includes(item.type)
        ? [...acc, ...flattenUiGroups(item.items)]
        : [...acc, { ...item, address: item.address }],
    []
  );

const convertUiToParamDescriptors = ui => {
  const flattenedUiItems = flattenUiGroups(ui);
  return flattenedUiItems.map(item => ({
    name: item.address,
    defaultValue: 0,
    minValue: Math.min(+(item.min || 0), 0),
    maxValue: item.type === 'button'||item.type==='checkbox' ? 1 : (+(item.max || 0)),
    // We use k-rate for all since these values are only read once for every `BUFFER_SIZE` frames anyway
    automationRate: 'k-rate',
  }));
};

const paramDescriptors = convertUiToParamDescriptors(jsonModuleDef.ui);

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

const BUFFER_SIZE = 128; // TODO: Figure out what the optimal value for this is
const SAMPLE_RATE = 44100;
const POINTER_SIZE = 4;
const SAMPLE_SIZE = 4;

const heap2Str = buf => {
  let str = '';
  let i = 0;

  while (buf[i] !== 0) {
    str += String.fromCharCode(buf[i++]);
  }

  return str;
};

const clamp = (min, max, val) => Number.isNaN(val) ? 0.0 : Math.min(Math.max(min, val), max);

class FaustAudioWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return paramDescriptors;
  }

  constructor() {
    super();

    this.dspInChannels = [];
    this.dspOutChannels = [];

    this.dsp = 0;
    this.outs = null;
    this.isShutdown = false;

    this.pathTable = null;

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
        this.audioHeapInputs + this.numberOfInputs * this.bufferSize * SAMPLE_SIZE;
      this.init();
    };

    this.initDspInstance = async arrayBuffer => {
      const compiledModule = await WebAssembly.compile(arrayBuffer);
      this.dspInstance = new WebAssembly.Instance(compiledModule, importObject);
    };

    this.log = (...args) => this.port.postMessage({ log: args });

    this.init = () => {
      if (this.numberOfInputs > 0) {
        const ins = this.audioHeapPtrInputs;

        for (let i = 0; i < this.numberOfInputs; i++) {
          this.HEAP32[(ins >> 2) + i] = this.audioHeapInputs + this.bufferSize * SAMPLE_SIZE * i;
        } // Prepare Ins buffer tables

        const dspInChans = this.HEAP32.subarray(
          ins >> 2,
          (ins + this.numberOfInputs * POINTER_SIZE) >> 2
        );

        for (let i = 0; i < this.numberOfInputs; i++) {
          this.dspInChannels[i] = this.HEAPF32.subarray(
            dspInChans[i] >> 2,
            (dspInChans[i] + this.bufferSize * SAMPLE_SIZE) >> 2
          );
        }
      }

      if (this.numberOfOutputs) {
        this.outs = this.audioHeapPtrOutputs;

        for (let i = 0; i < this.numberOfOutputs; i++) {
          this.HEAP32[(this.outs >> 2) + i] =
            this.audioHeapOutputs + this.bufferSize * SAMPLE_SIZE * i;
        }

        // Prepare Out buffer tables
        const dspOutChans = this.HEAP32.subarray(
          this.outs >> 2,
          (this.outs + this.numberOfOutputs * POINTER_SIZE) >> 2
        );

        for (let i = 0; i < this.numberOfOutputs; i++) {
          this.dspOutChannels[i] = this.HEAPF32.subarray(
            dspOutChans[i] >> 2,
            (dspOutChans[i] + this.bufferSize * SAMPLE_SIZE) >> 2
          );
        }
      }

      this.dspInstance.exports.init(this.dsp, SAMPLE_RATE);
    };

    this.bufferSize = BUFFER_SIZE;

    this.port.onmessage = async event => {
      switch (event.data.type) {
        case 'setPathTable': {
          this.pathTable = event.data.pathTable;
          this.allDefaultParamsAreZero = event.data.allDefaultParamsAreZero;
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
          this.log(`Unhandled message type: ${event.data.type}`);
        }
      }
    };
  }

  process(inputs, outputs, params) {
    if (this.isShutdown) {
      return false;
    } else if (!this.dspInstance || !this.pathTable) {
      return true;
    }

    // Set all params into the Wasm memory from the latest values we have to our `AudioParam`s
    let allZero = true;
    paramDescriptors.forEach(param => {
      const paramValue = params[param.name][0];
      if (paramValue === undefined || Number.isNaN(paramValue)) {
        return;
      }

      this.dspInstance.exports.setParamValue(
        this.dsp,
        this.pathTable[param.name],
        // We only support k-rate params since Faust processes all of the frames at once and only supports
        // a single value for each param.
        clamp(param.minValue, param.maxValue, paramValue)
      );
      allZero = allZero && paramValue === 0;
    });
    // There's a quirk in Firefox where params seem to be delayed and a few frames are rendered before
    // the default values set into the params are set.  This is a workaround for that; we have a flag
    // that indicates whether all the default values are zero and if they aren't, we wait until they are
    // set to non-zero values before rendering anything.
    if (!this.hasSuccessfullyRendered && !this.allDefaultParamsAreZero && allZero) {
      return true;
    }
    this.hasSuccessfullyRendered = true;

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
      this.bufferSize,
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

registerProcessor(`faust-worklet-processor-${moduleId}`, FaustAudioWorkletProcessor);
