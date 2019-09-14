import importObject from './faustModuleImportObject';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Map<string, Float32Array>
  ): void;
}

declare function registerProcessor<P>(
  audioWorkletProcessorName: string,
  audioWorkletProcessor: P
): void;

interface JsonDef {
  size: string;
  inputs: string;
  outputs: string;
  ui: unknown;
}

const BUFFER_SIZE = 128;
const SAMPLE_RATE = 44100;
const POINTER_SIZE = 4 as const;
const SAMPLE_SIZE = 4 as const;

const heap2Str = (buf: Uint8Array) => {
  let str = '';
  let i = 0;
  while (buf[i] !== 0) {
    str += String.fromCharCode(buf[i++]);
  }
  return str;
};

export default class FaustAudioWorkletProcessor extends AudioWorkletProcessor {
  private jsonDef: JsonDef;
  private dspInstance: WebAssembly.Instance;
  private bufferSize: number;
  private HEAP: ArrayBuffer;
  private HEAPU8: Uint8Array;
  private HEAP32: Int32Array;
  private HEAPF32: Float32Array;
  private audioHeapPtr: number;
  private numberOfInputs: number;
  private numberOfOutputs: number;
  private dspInChannels: Float32Array[] = [];
  private dspOutChannels: Float32Array[] = [];
  private audioHeapPtrInputs: number;
  private audioHeapPointerOutputs: number;
  private audioHeapInputs: number;
  private audioHeapOutputs: number;

  /**
   * Start of DSP memory : DSP is placed first with index 0
   */
  private dsp = 0;

  private outs: number | null = null;

  constructor() {
    super();
    this.bufferSize = BUFFER_SIZE;

    this.port.onmessage = async event => {
      await this.initWithModule(event.data);
      this.port.postMessage('initialized');
    };
  }

  private initWithModule = async (dspInstanceArrayBuffer: ArrayBuffer) => {
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
    this.audioHeapPointerOutputs = this.audioHeapPtrInputs + this.numberOfInputs * POINTER_SIZE;

    this.audioHeapInputs = this.audioHeapPointerOutputs + this.numberOfOutputs * POINTER_SIZE;
    this.audioHeapOutputs =
      this.audioHeapInputs + this.numberOfInputs * this.bufferSize * SAMPLE_SIZE;

    this.init();
  };

  private initDspInstance = async (arrayBuffer: ArrayBuffer) => {
    const compiledModule = await WebAssembly.compile(arrayBuffer);
    this.dspInstance = new WebAssembly.Instance(compiledModule, importObject);
  };

  private init = () => {
    if (this.numberOfInputs > 0) {
      const ins = this.audioHeapPtrInputs;
      for (let i = 0; i < this.numberOfInputs; i++) {
        this.HEAP32[(ins >> 2) + i] = this.audioHeapInputs + this.bufferSize * SAMPLE_SIZE * i;
      }

      // Prepare Ins buffer tables
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
      this.outs = this.audioHeapPointerOutputs;
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

    // Init DSP
    this.dspInstance.exports.init(this.dsp, SAMPLE_RATE);
  };

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Map<string, Float32Array>
  ) {
    for (let i = 0; i < this.numberOfInputs; i++) {
      // Copy inputs into the Wasm heap
      const inputChannel0 = inputs[i][0];
      const dspInput = this.dspInChannels[i];
      dspInput.set(inputChannel0);

      // Compute on the Faust/Wasm side
      this.dspInstance.exports.compute(this.dsp, this.bufferSize);

      // Copy computed outputs from the Wasm heap into the WebAudio output buffer
      for (let i = 0; i < this.numberOfOutputs; i++) {
        // Write outputs
        const outputChannel0 = outputs[i][0];
        const dspOutput = this.dspOutChannels[i];
        outputChannel0.set(dspOutput);
      }
    }

    return true;
  }
}

registerProcessor('faust-worklet-processor', FaustAudioWorkletProcessor);
