import { LooperInstState } from 'src/redux/modules/looper';
import { AsyncOnce } from 'src/util';

const ctx = new AudioContext();

const LooperAWPRegistered = new AsyncOnce(() =>
  ctx.audioWorklet.addModule(
    '/LooperAWP.js?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
  )
);

const LooperWasm = new AsyncOnce(() =>
  fetch(
    '/looper.wasm?cacheBust=' +
      (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
  ).then(res => res.arrayBuffer())
);

export class LooperNode extends AudioWorkletNode {
  private vcId: string;

  constructor(vcId: string, serialized?: LooperInstState) {
    super(ctx, 'looper-awp');
    this.vcId = vcId;

    if (serialized) {
      this.deserialize(serialized);
    }

    this.init();
  }

  private deserialize(serialized: LooperInstState) {
    this.setActiveBankIx(serialized.activeBankIx);

    serialized.banks?.forEach((bank, bankIx) => {
      // TODO
    });
  }

  public setActiveBankIx(bankIx: number | null) {
    this.port.postMessage({ type: 'setActiveBankIx', bankIx });
  }

  private async init() {
    const looperWasm = await LooperWasm.get();
    this.port.postMessage(
      {
        type: 'setWasmBytes',
        wasmBytes: looperWasm,
      },
      [looperWasm]
    );
  }
}

export const buildLooperNode = async (vcId: string, serialized?: LooperInstState) => {
  // Eagerly start fetching looper wasm
  LooperWasm.get();

  await LooperAWPRegistered.get();
  const node = new LooperNode(vcId, serialized);
  return node;
};
