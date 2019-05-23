import { audioContext } from '../redux/reducers/faustEditor';
import { initializeSpectrumVisualization } from '../visualizations/spectrum';
import { FaustModuleInstance } from './FaustEditor';

declare class FaustWasm2ScriptProcessor {
  public constructor(name: string, props: {}, options: {});

  public getNode(
    wasmInstance: any,
    audioContext: AudioContext,
    bufferSize: number
  ): FaustModuleInstance;
}

export const analyzerNode = audioContext.createAnalyser();
analyzerNode.smoothingTimeConstant = 0.2;
analyzerNode.connect(audioContext.destination);

const getMicrophoneStream = (): Promise<MediaStream> =>
  new Promise((fulfill, reject) => {
    if (navigator.getUserMedia) {
      navigator.getUserMedia({ audio: true }, fulfill, reject);
    }
    fulfill(navigator.mediaDevices.getUserMedia({ audio: true }));
  });

const buildInstance = async (wasmInstance: WebAssembly.Instance, dspDefProps: {}) => {
  // Create a faust module instance (which extends `ScriptProcessorNode`) from the Wasm module
  const converterInstance = new FaustWasm2ScriptProcessor('name', dspDefProps, {
    debug: false,
  });

  const faustInstance = await converterInstance.getNode(wasmInstance, audioContext, 1024);

  const microphoneStream = await getMicrophoneStream();
  const source = audioContext.createMediaStreamSource(microphoneStream);

  const canvas = document.getElementById('spectrum-visualizer')! as HTMLCanvasElement;

  initializeSpectrumVisualization(analyzerNode, canvas);

  // Wire up the microphone to the module, connect the module to the analyzer node, and then
  // connect the analyzer node to the audo context's output (speakers)
  source.connect(faustInstance);
  faustInstance.connect(analyzerNode);

  return faustInstance;
};

export default buildInstance;
