import { AsyncOnce } from 'src/util';

const fetchWavetableWasmBytes = async (): Promise<ArrayBuffer> => {
  const simdStatusElem = document.getElementById('simd-status');
  if (simdStatusElem) {
    simdStatusElem.setAttribute('style', 'display:block; color: #08bf3f;');
  }
  let path = process.env.ASSET_PATH + 'wavetable.wasm';
  if (!window.location.host.includes('localhost')) {
    path += `?cacheBust=${genRandomStringID()}`;
  }
  return fetch(path).then(res => res.arrayBuffer());
};

export const WavetableWasmBytes = new AsyncOnce(fetchWavetableWasmBytes, true);
