import * as Comlink from 'comlink';

export class MIDIMinimapRendererWorker {
  private wasmInstance: Promise<WebAssembly.Instance>;
  private setWasmInstance: (wasmInstance: WebAssembly.Instance) => void = () => {
    throw new Error('Unreachable');
  };
  private textDecoder = new TextDecoder('utf-8');

  constructor() {
    this.wasmInstance = new Promise(resolve => {
      this.setWasmInstance = resolve;
    });
  }

  private handleWasmPanic = async (ptr: number, len: number) => {
    const wasm = await this.wasmInstance;
    const memory = wasm.exports.memory as WebAssembly.Memory;
    console.error('WASM error', this.textDecoder.decode(memory.buffer.slice(ptr, ptr + len)));
  };

  public setWasmBytes = async (wasmBytes: ArrayBuffer) => {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const importObj = { env: { log_err: this.handleWasmPanic } };
    const wasmInstance = await WebAssembly.instantiate(wasmModule, importObj);
    this.setWasmInstance(wasmInstance);
  };

  public renderMinimap = async (
    encodedNotes: ArrayBuffer,
    beatsPerMeasure: number
  ): Promise<string> => {
    const wasm = await this.wasmInstance;

    const encodedNotesBufPtr: number = (wasm.exports.get_encoded_notes_buf_ptr as any)(
      encodedNotes.byteLength
    );
    let memory = wasm.exports.memory as WebAssembly.Memory;
    const encodedNotesBuf = new Uint8Array(memory.buffer).subarray(
      encodedNotesBufPtr,
      encodedNotesBufPtr + encodedNotes.byteLength
    );
    encodedNotesBuf.set(new Uint8Array(encodedNotes));

    const minimapSVGStringPtr = (wasm.exports.midi_minimap_render_minimap as any)(beatsPerMeasure);
    const svgTextLength = (wasm.exports.midi_minimap_get_svg_text_length as any)();
    memory = wasm.exports.memory as WebAssembly.Memory;
    const svgText = this.textDecoder.decode(
      memory.buffer.slice(minimapSVGStringPtr, minimapSVGStringPtr + svgTextLength)
    );
    return svgText;
  };
}

Comlink.expose(new MIDIMinimapRendererWorker());
