import { AsyncOnce } from 'src/util';

// Single init point for the midi wasm module; concurrent consumers must share one
// instantiation since the wasm-bindgen glue doesn't dedupe in-flight `init()` calls.
export const MIDIWasmModule = new AsyncOnce(async () => {
  const mod = await import('src/midi');
  await mod.default();
  return mod;
});
