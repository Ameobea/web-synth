import { AsyncOnce } from 'src/util';
import type { SerializedSampleEditorState } from './SampleEditor';

const ctx = new AudioContext();

const SampleEditorAWPWasm = new AsyncOnce(() =>
  fetch(
    process.env.ASSET_PATH +
      'sample_editor.wasm' +
      (window.location.href.includes('localhost')
        ? ''
        : '?cacheBust=' + btoa(Math.random().toString()))
  ).then(res => res.arrayBuffer())
);

const AWPModuleAdded = new AsyncOnce(() =>
  ctx.audioWorklet.addModule(
    process.env.ASSET_PATH +
      'TODO.js' +
      (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
  )
);

export default class SampleEditorAWP extends AudioWorkletNode {
  constructor() {
    super(ctx, 'sample-editor-awp');

    // Kick off loading the AWP Wasm because we're going to need it soon
    SampleEditorAWPWasm.get();
    AWPModuleAdded.get();
  }

  public async init(state: SerializedSampleEditorState) {
    const [sampleEditorAWPWasm] = await Promise.all([
      SampleEditorAWPWasm.get(),
      AWPModuleAdded.get(),
    ] as const);

    // TODO
    this.port.postMessage({ type: 'init', wasmBytes: sampleEditorAWPWasm });
  }
}
