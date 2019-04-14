import { audioContext } from '../redux/reducers/faustEditor';
import { FaustModuleInstance } from './FaustEditor';

declare class FaustWasm2ScriptProcessor {
  constructor(name: string, props: {}, options: {});

  getNode(wasmInstance: any, audioContext: AudioContext, bufferSize: number): FaustModuleInstance;
}

const { WebAssembly } = window as any;

const getMicrophoneStream = (): Promise<MediaStream> =>
  new Promise((fulfill, reject) => {
    if (navigator.getUserMedia) {
      navigator.getUserMedia({ audio: true }, fulfill, reject);
    }
    fulfill(navigator.mediaDevices.getUserMedia({ audio: true }));
  });

const buildInstance = async (wasmInstance: typeof WebAssembly.Instance, dspDefProps: {}) => {
  // Create a faust module instance (which extends `ScriptProcessorNode`) from the Wasm module
  const converterInstance = new FaustWasm2ScriptProcessor('name', dspDefProps, {
    debug: false,
  });

  const faustInstance = await converterInstance.getNode(wasmInstance, audioContext, 1024);

  const microphoneStream = await getMicrophoneStream();
  const source = audioContext.createMediaStreamSource(microphoneStream);

  // Wire up the microphone to the module and then connect the module to the audo context's output (speakers)
  source.connect(faustInstance);
  faustInstance.connect(audioContext.destination);

  return faustInstance;
};

export default buildInstance;
