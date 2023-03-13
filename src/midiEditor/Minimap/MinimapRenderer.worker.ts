import * as Comlink from 'comlink';

export class MIDIMinimapRendererWorker {
  private wasmInstance: WebAssembly.Instance | null = null;
  private textDecoder = new TextDecoder('utf-8');

  private handleWasmPanic = (ptr: number, len: number) => {
    const memory = this.wasmInstance!.exports.memory as WebAssembly.Memory;
    console.error('WASM error', this.textDecoder.decode(memory.buffer.slice(ptr, ptr + len)));
  };

  public setWasmBytes = async (wasmBytes: ArrayBuffer) => {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const importObj = { env: { log_err: this.handleWasmPanic } };
    const wasmInstance = await WebAssembly.instantiate(wasmModule, importObj);
    this.wasmInstance = wasmInstance;
  };

  public renderMinimap = (encodedNotes: ArrayBuffer): string => {
    if (!this.wasmInstance) {
      throw new Error('WASM not initialized');
    }

    const memory = this.wasmInstance.exports.memory as WebAssembly.Memory;
    const encodedNotesBufPtr: number = (this.wasmInstance.exports.get_encoded_notes_buf_ptr as any)(
      encodedNotes.byteLength
    );
    const encodedNotesBuf = new Uint8Array(memory.buffer).subarray(
      encodedNotesBufPtr,
      encodedNotesBufPtr + encodedNotes.byteLength
    );
    encodedNotesBuf.set(new Uint8Array(encodedNotes));

    const minimapSVGStringPtr = (this.wasmInstance.exports.midi_minimap_render_minimap as any)(
      encodedNotes.byteLength
    );
    const svgTextLength = (this.wasmInstance.exports.midi_minimap_get_svg_text_length as any)();
    const svgText = this.textDecoder.decode(
      memory.buffer.slice(minimapSVGStringPtr, minimapSVGStringPtr + svgTextLength)
    );
    console.log(svgText);
    return svgText;
  };
}

Comlink.expose(new MIDIMinimapRendererWorker());
