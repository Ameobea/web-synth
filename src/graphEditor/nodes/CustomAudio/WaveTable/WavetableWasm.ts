import { getSentry } from 'src/sentry';
import { AsyncOnce, getHasSIMDSupport } from 'src/util';

const fetchWavetableWasmBytes = async (): Promise<ArrayBuffer> => {
  const hasSIMDSupport = getHasSIMDSupport();
  getSentry()?.setContext('wasmSIMDSupport', { hasWasmSIMDSupport: hasSIMDSupport });
  if (!window.location.href.includes('localhost')) {
    console.log(
      hasSIMDSupport
        ? 'Wasm SIMD support detected!'
        : 'Wasm SIMD support NOT detected; using fallback Wasm'
    );
  }
  const simdStatusElem = document.getElementById('simd-status');
  if (simdStatusElem) {
    if (hasSIMDSupport) {
      simdStatusElem.setAttribute('style', 'display:block; color: #08bf3f;');
    } else {
      simdStatusElem.innerHTML = 'SIMD support not detected; using non-SIMD Wasm';
      simdStatusElem.setAttribute('style', 'display:block; color: #cfeb1e;');
    }
  }
  let path =
    process.env.ASSET_PATH + (hasSIMDSupport ? 'wavetable.wasm' : 'wavetable_no_simd.wasm');
  if (!window.location.host.includes('localhost')) {
    path += `?cacheBust=${genRandomStringID()}`;
  }
  const res = fetch(path);
  return res.then(res => res.arrayBuffer());
};

export const WavetableWasmBytes = new AsyncOnce(fetchWavetableWasmBytes, true);
