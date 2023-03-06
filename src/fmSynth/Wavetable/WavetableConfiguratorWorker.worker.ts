import * as Comlink from 'comlink';

const WAVEFORM_IMAGE_HEIGHT_PX = 256;
const WAVEFORM_IMAGE_WIDTH_PX = 1024;
const WAVEFORM_LENGTH_SAMPLES = 1024 * 4;

export class WavetableConfiguratorWorker {
  private wasmInstance: Promise<WebAssembly.Instance>;
  private setWasmInstance!: (instance: WebAssembly.Instance) => void;

  constructor() {
    this.wasmInstance = new Promise<WebAssembly.Instance>(resolve => {
      this.setWasmInstance = resolve;
    });
  }

  public setWasmBytes = async (wasmBytes: ArrayBuffer) => {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const wasmInstance = await WebAssembly.instantiate(wasmModule, {
      env: {
        log_err: (ptr: number, len: number) => {
          console.error(
            'WASM error',
            new TextDecoder().decode(new Uint8Array(wasmBytes.slice(ptr, ptr + len)))
          );
        },
      },
    });
    this.setWasmInstance(wasmInstance);
  };

  private encodeState = (harmonics: { magnitude: number; phase: number }[]): Float32Array => {
    const encodedState = new Float32Array(harmonics.length * 2);
    // magnitude, phase
    encodedState.set(harmonics.map(h => h.magnitude));
    encodedState.set(
      harmonics.map(h => h.phase),
      harmonics.length
    );
    return encodedState;
  };

  public renderWaveform = async (harmonics: { magnitude: number; phase: number }[]) => {
    const inst = await this.wasmInstance;
    const memory = inst.exports.memory as WebAssembly.Memory;

    const encodedState = this.encodeState(harmonics);
    const encodedStateBufPtr: number = (inst.exports.get_encoded_state_buf_ptr as any)();
    const encodedStateBuf = new Float32Array(memory.buffer).subarray(
      encodedStateBufPtr / 4,
      encodedStateBufPtr / 4 + encodedState.length
    );
    encodedStateBuf.set(encodedState);

    const waveformImagePtr = (inst.exports.wavegen_render_waveform as any)();
    const waveformImage = new Uint8Array(
      memory.buffer.slice(
        waveformImagePtr,
        waveformImagePtr + WAVEFORM_IMAGE_HEIGHT_PX * WAVEFORM_IMAGE_WIDTH_PX * 4
      )
    );

    const waveformBufPtr: number = (inst.exports.wavegen_get_waveform_buf_ptr as any)();
    const waveformSamples = new Float32Array(memory.buffer).slice(
      waveformBufPtr / 4,
      waveformBufPtr / 4 + WAVEFORM_LENGTH_SAMPLES
    );
    if (waveformSamples.some(isNaN)) {
      console.error('NaN in waveform samples', waveformSamples);
      throw new Error('NaN in waveform samples');
    }

    return Comlink.transfer({ waveformImage, waveformSamples }, [
      waveformImage.buffer,
      waveformSamples.buffer,
    ]);
  };

  public renderWavetable = async (
    waveforms: { harmonics: { magnitude: number; phase: number }[] }[]
  ) => {
    const inst = await this.wasmInstance;
    const memory = inst.exports.memory as WebAssembly.Memory;

    const renderedWavetable: Float32Array[] = [];
    for (let i = 0; i < waveforms.length; i++) {
      const encodedState = this.encodeState(waveforms[i].harmonics);
      const encodedStateBufPtr: number = (inst.exports.get_encoded_state_buf_ptr as any)();
      const encodedStateBuf = new Float32Array(memory.buffer).subarray(
        encodedStateBufPtr / 4,
        encodedStateBufPtr / 4 + encodedState.length
      );
      encodedStateBuf.set(encodedState);

      (inst.exports.wavegen_render_waveform as any)();

      const waveformBufPtr: number = (inst.exports.wavegen_get_waveform_buf_ptr as any)();
      // Need to clone the array buffer because the wasm module will overwrite it
      const waveformSamples = new Float32Array(WAVEFORM_LENGTH_SAMPLES);
      waveformSamples.set(
        new Float32Array(memory.buffer).slice(
          waveformBufPtr / 4,
          waveformBufPtr / 4 + WAVEFORM_LENGTH_SAMPLES
        )
      );

      if (waveformSamples.some(isNaN)) {
        console.error('NaN in waveform samples', waveformSamples);
        throw new Error('NaN in waveform samples');
      }

      // Normalize
      const max = Math.max(...waveformSamples);
      const min = Math.min(...waveformSamples);
      const absMax = Math.max(Math.abs(max), Math.abs(min));
      for (let j = 0; j < waveformSamples.length; j++) {
        waveformSamples[j] /= absMax;
      }

      renderedWavetable.push(waveformSamples);
    }

    return Comlink.transfer(
      renderedWavetable,
      renderedWavetable.map(w => w.buffer)
    );
  };
}

Comlink.expose(new WavetableConfiguratorWorker());
