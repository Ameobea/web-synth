import * as Comlink from 'comlink';

import { MIDIMinimapRendererWorker } from 'src/midiEditor/Minimap/MinimapRenderer.worker';
import { NoteBox } from 'src/midiEditor/NoteBox';
import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';

const MIDIRendererWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'midi_renderer.wasm' +
        (window.location.host.includes('localhost') ? '' : `?${crypto.randomUUID()}`)
    ).then(res => res.arrayBuffer()),
  true
);

// Lazily instantiate the worker
let worker: Comlink.Remote<MIDIMinimapRendererWorker> | null = null;

const getWorker = ():
  | Comlink.Remote<MIDIMinimapRendererWorker>
  | Promise<Comlink.Remote<MIDIMinimapRendererWorker>> => {
  if (worker) {
    return worker;
  }

  const wasmBytes = MIDIRendererWasmBytes.get();
  worker = Comlink.wrap(new Worker(new URL('./MinimapRenderer.worker.ts', import.meta.url)));
  return wasmBytes
    .then(async wasmBytes => {
      await worker!.setWasmBytes(wasmBytes);
      return worker!;
    })
    .catch((err: any) => {
      logError('Error setting wasm bytes to minimap renderer worker', err);
      throw err;
    });
};

const encodeMIDINotes = (allNotesByID: Map<number, NoteBox>, lineCount: number): ArrayBuffer => {
  const noteCount = allNotesByID.size;
  // Buffer format:
  // [midiNumber, startPoint, length]
  // [i32, f32, f32]
  const buffer = new ArrayBuffer(noteCount * 3 * 4);
  const f32 = new Float32Array(buffer);
  const i32 = new Int32Array(buffer);

  for (const [noteIx, note] of allNotesByID.entries()) {
    const lineIx = note.line.index;
    i32[noteIx * 3] = lineCount - lineIx;
    f32[noteIx * 3 + 1] = note.note.startPoint;
    f32[noteIx * 3 + 2] = note.note.length;
  }

  return buffer;
};

/**
 * @returns a string of SVG data
 */
export const renderMIDIMinimap = async (allNotesByID: Map<number, NoteBox>, lineCount: number) => {
  const worker = await getWorker();
  const encodedNotes = encodeMIDINotes(allNotesByID, lineCount);
  const svgText = await worker.renderMinimap(encodedNotes);
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = svgDoc.documentElement;
  svg.setAttribute('width', '100%');
  return svg;
};
