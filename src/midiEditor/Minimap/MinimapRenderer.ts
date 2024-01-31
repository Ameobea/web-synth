import * as Comlink from 'comlink';

import type { SerializedMIDILine } from 'src/midiEditor';
import type { MIDIMinimapRendererWorker } from 'src/midiEditor/Minimap/MinimapRenderer.worker';
import { logError } from 'src/sentry';
import { AsyncOnce } from 'src/util';

const MIDIRendererWasmBytes = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'midi_renderer.wasm' +
        (window.location.host.includes('localhost') ? '' : `?${genRandomStringID()}`)
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

const encodeMIDINotes = (lines: SerializedMIDILine[]): ArrayBuffer => {
  const lineCount = lines.length;
  const noteCount = lines.reduce((sum, line) => sum + line.notes.length, 0);
  // Buffer format:
  // [midiNumber, startPoint, length]
  // [i32, f32, f32]
  const buffer = new ArrayBuffer(noteCount * 3 * 4);
  const f32 = new Float32Array(buffer);
  const i32 = new Int32Array(buffer);

  let noteIx = 0;
  for (let lineIx = 0; lineIx < lineCount; lineIx += 1) {
    const line = lines[lineIx];
    for (const note of line.notes) {
      i32[noteIx * 3] = lineCount - lineIx;
      f32[noteIx * 3 + 1] = note.startPoint;
      f32[noteIx * 3 + 2] = note.length;
      noteIx += 1;
    }
  }

  return buffer;
};

/**
 * @returns a string of SVG data
 */
export const renderMIDIMinimap = async (
  lines: SerializedMIDILine[],
  beatsPerMeasure: number
): Promise<SVGSVGElement> => {
  // There are issues with cross-domain workers which come up when using headless mode.
  //
  // Since we're headless anyway, we can just no-op this.
  if ((window as any).isHeadless) {
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  }

  const worker = await getWorker();
  const encodedNotes = encodeMIDINotes(lines);
  const svgText = await worker.renderMinimap(encodedNotes, beatsPerMeasure);
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = svgDoc.documentElement as unknown as SVGSVGElement;
  svg.setAttribute('width', '100%');
  return svg;
};
