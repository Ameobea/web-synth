import { Map as ImmMap } from 'immutable';

import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import {
  buildDefaultSignalAnalyzerInstState,
  type SerializedSignalAnalyzerInst,
  SignalAnalyzerInst,
} from 'src/signalAnalyzer/SignalAnalyzerInst';
import { mkSvelteContainerCleanupHelper, mkSvelteContainerRenderHelper } from 'src/svelteUtils.svelte';
import { noop, tryParseJson } from 'src/util';

interface SignalAnalyzerHandle {
  input: AnalyserNode;
  pause: () => void;
  resume: () => void;
  serialize: () => SerializedSignalAnalyzerInst;
  destroy: () => void;
}

const SignalAnalyzerInstsByStateKey = new Map<string, SignalAnalyzerHandle>();

const ctx = new AudioContext();

export const init_signal_analyzer = (stateKey: string) => {
  const serialized = localStorage.getItem(stateKey);
  const parsed = tryParseJson<SerializedSignalAnalyzerInst, undefined>(
    serialized!,
    undefined,
    `Failed to parse localStorage state for signal analyzer with stateKey ${stateKey}; reverting to initial state.`
  );
  if (serialized !== null && parsed === undefined) {
    // clear the corrupt-but-present key so the default state doesn't get persisted over it on unload
    localStorage.removeItem(stateKey);
  }
  const initialState = parsed ?? buildDefaultSignalAnalyzerInstState();
  initialState.oscilloscopeUIState.frozen = false;

  if ((window as any).isHeadless) {
    // This VC is a pure sink with no outputs, so all that's needed in headless mode is an input
    // node for connections to target; the AWP, oscilloscope + spectrogram workers, and UI are
    // all skipped.
    SignalAnalyzerInstsByStateKey.set(stateKey, {
      input: ctx.createAnalyser(),
      pause: noop,
      resume: noop,
      serialize: () => initialState,
      destroy: noop,
    });
    return;
  }

  const elem = document.createElement('div');
  elem.id = stateKey;
  elem.setAttribute(
    'style',
    'z-index: 2; width: 100%; height: calc(100vh - 34px); overflow-y: hidden; position: absolute; top: 0; left: 0; display: none;'
  );
  document.getElementById('content')!.appendChild(elem);

  const inst = new SignalAnalyzerInst(ctx, initialState);
  SignalAnalyzerInstsByStateKey.set(stateKey, inst);

  void import('src/signalAnalyzer/SignalAnalyzerUI.svelte').then(
    ({ default: SignalAnalyzerUI }) => {
      if (!elem.isConnected) {
        return;
      }

      mkSvelteContainerRenderHelper({
        Comp: SignalAnalyzerUI,
        getProps: () => ({ inst }),
      })(stateKey);
    }
  );
};

export const hide_signal_analyzer = (stateKey: string) => {
  const elem = document.getElementById(stateKey);
  if (elem) {
    elem.style.display = 'none';
  } else if (!(window as any).isHeadless) {
    console.error(`No element found for state key ${stateKey} when hiding signal analyzer`);
  }

  const inst = SignalAnalyzerInstsByStateKey.get(stateKey);
  if (!inst) {
    throw new Error(`No signal analyzer instance found for state key ${stateKey}`);
  }
  inst.pause();
};

export const unhide_signal_analyzer = (stateKey: string) => {
  const elem = document.getElementById(stateKey);
  if (elem) {
    elem.style.display = 'block';
  } else if (!(window as any).isHeadless) {
    console.error(`No element found for state key ${stateKey} when un-hiding signal analyzer`);
  }

  const inst = SignalAnalyzerInstsByStateKey.get(stateKey);
  if (!inst) {
    throw new Error(`No signal analyzer instance found for state key ${stateKey}`);
  }
  inst.resume();
};

export const persist_signal_analyzer = (stateKey: string) => {
  const inst = SignalAnalyzerInstsByStateKey.get(stateKey);
  if (!inst) {
    throw new Error(`No signal analyzer instance found for state key ${stateKey}`);
  }
  const state = inst.serialize();
  localStorage.setItem(stateKey, JSON.stringify(state));
};

export const cleanup_signal_analyzer = (stateKey: string) => {
  persist_signal_analyzer(stateKey);

  SignalAnalyzerInstsByStateKey.get(stateKey)?.destroy();
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
