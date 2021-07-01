const FRAME_SIZE = 128;
const SAMPLE_RATE = 44100;

const jsonModuleDef = {{.JSONModuleDef}};

const moduleId = "{{.ModuleID}}";

const paramDescriptors = jsonModuleDef.parameters.map(param => ({
  name: param.id,
  defaultValue: 0,
  minValue: param.minValue,
  maxValue: param.maxValue,
  // We use k-rate for all since these values are only read once for every `BUFFER_SIZE` frames anyway
  automationRate: 'k-rate',
}));

const ParamIndicesByID = new Map();
jsonModuleDef.parameters.forEach(param => ParamIndicesByID.set(param.id, param.index));

class SoulAWP extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return paramDescriptors;
  }

  constructor() {
    super();

    this.isShutdown = false;
    this.lastParamValues = new Map();
    this._moduleDescription = null;
    this.inputBuffer = null;
    this.outputBuffer = null;

    this.port.onmessage = async evt => {
      switch (evt.data.type) {
        case 'init': {
          await this.initWithModule(evt.data.dspArrayBuffer);
          this.port.postMessage({ type: 'jsonDef', jsonDef: jsonModuleDef });
          break;
        }
        case 'shutdown': {
          this.isShutdown = true;
          break;
        }
        default: {
          console.error('Unhandled message type in soul AWP: ', evt.data.type);
        }
      }
    };
  }

  /**
   * @param {ArrayBuffer} dspArrayBuffer
   */
  async initWithModule(dspArrayBuffer) {
    const compiledModule = await WebAssembly.compile(dspArrayBuffer);
    this.dspInstance = await WebAssembly.instantiate(compiledModule);

    this.dspInstance.exports.prepareToPlay(SAMPLE_RATE);

    this.inputBuffer = new Float32Array(
      this.dspInstance.exports.memory.buffer,
      this.dspInstance.exports.getInData(0),
      FRAME_SIZE
    );
    this.outputBuffer = new Float32Array(
      this.dspInstance.exports.memory.buffer,
      this.dspInstance.exports.getOutData(0),
      FRAME_SIZE
    );
  }

  /**
   * Checks if parameters have changed since the last
   */
  updateParams(parameters) {
    for (const paramName in parameters) {
      const param = parameters[paramName];
      const val = param[0];
      if (val !== this.lastParamValues.get(paramName)) {
        this.lastParamValues.set(paramName, val);
        const paramIndex = ParamIndicesByID.get(paramName);
        this.dspInstance.exports.onParameterUpdate(paramIndex, val);
      }
    }
  }

  process(inputs, outputs, parameters) {
    if (this.isShutdown) {
      return false;
    } else if (!this.dspInstance) {
      return true;
    }

    this.updateParams(parameters);

    const input = inputs[0]?.[0];
    if (input) {
      this.inputBuffer.set(input);
    } else {
      this.inputBuffer.fill(0);
    }

    this.dspInstance.exports.processBlock(FRAME_SIZE);

    outputs.forEach(output => output.forEach(channel => channel.set(this.outputBuffer)));

    return true;
  }
}

registerProcessor('soul-awp-' + moduleId, SoulAWP);
