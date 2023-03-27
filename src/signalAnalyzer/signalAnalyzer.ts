import { Map as ImmMap } from 'immutable';

import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerHider } from 'src/reactUtils';
import { SignalAnalyzerInst } from 'src/signalAnalyzer/SignalAnalyzerInst';
import SignalAnalyzerUI from 'src/signalAnalyzer/SignalAnalyzerUI.svelte';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils';

const SignalAnalyzerInstsByStateKey = new Map<string, SignalAnalyzerInst>();

const ctx = new AudioContext();

export const init_signal_analyzer = (stateKey: string) => {
  const elem = document.createElement('div');
  elem.id = stateKey;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: scroll; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const inst = new SignalAnalyzerInst(ctx);
  SignalAnalyzerInstsByStateKey.set(stateKey, inst);

  mkSvelteContainerRenderHelper({
    Comp: SignalAnalyzerUI,
    getProps: () => ({ inst }),
  })(stateKey);
};

export const hide_signal_analyzer = (stateKey: string) => {
  const elem = document.getElementById(stateKey);
  if (!elem) {
    console.error(`No element found for state key ${stateKey} when hiding signal analyzer`);
    return;
  }
  elem.style.display = 'none';

  const inst = SignalAnalyzerInstsByStateKey.get(stateKey);
  if (!inst) {
    throw new Error(`No signal analyzer instance found for state key ${stateKey}`);
  }
  inst.pause();
};

export const unhide_signal_analyzer = (stateKey: string) => {
  const elem = document.getElementById(stateKey);
  if (!elem) {
    console.error(`No element found for state key ${stateKey} when un-hiding signal analyzer`);
    return;
  }
  elem.style.display = 'block';

  const inst = SignalAnalyzerInstsByStateKey.get(stateKey);
  if (!inst) {
    throw new Error(`No signal analyzer instance found for state key ${stateKey}`);
  }
  inst.resume();
};

export const cleanup_signal_analyzer = (stateKey: string) => {
  SignalAnalyzerInstsByStateKey.delete(stateKey);
  mkSvelteContainerCleanupHelper({ preserveRoot: false })(stateKey);
};

export const get_signal_analyzer_audio_connectables = (stateKey: string): AudioConnectables => {
  const inst = SignalAnalyzerInstsByStateKey.get(stateKey);
  if (!inst) {
    throw new Error(`No signal analyzer instance found for state key ${stateKey}`);
  }

  const vcId = stateKey.split('_')[1];
  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>().set('input', {
      type: 'customAudio',
      node: inst.input,
    }),
    outputs: ImmMap<string, ConnectableOutput>(),
  };
};
