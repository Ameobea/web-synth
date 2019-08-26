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
try {
  analyzerNode.smoothingTimeConstant = 0.2;
  analyzerNode.connect(audioContext.destination);
} catch (err) {
  console.error('Error connecting analyzer node to things: ', err);
}

const getMicrophoneStream = (): Promise<MediaStream> =>
  new Promise((fulfill, reject) => {
    if (navigator.getUserMedia) {
      navigator.getUserMedia({ audio: true }, fulfill, reject);
    }
    fulfill(navigator.mediaDevices.getUserMedia({ audio: true }));
  });

const buildInstance = async (
  wasmInstance: WebAssembly.Instance,
  externalSource?: AudioScheduledSourceNode,
  connectSource = true
) => {
  // Create a faust module instance (which extends `ScriptProcessorNode`) from the Wasm module
  const converterInstance = new FaustWasm2ScriptProcessor(
    'name',
    {},
    {
      debug: false,
    }
  );

  const faustInstance = await converterInstance.getNode(wasmInstance, audioContext, 256);

  const canvas = document.getElementById('spectrum-visualizer') as HTMLCanvasElement | undefined;
  if (canvas) {
    initializeSpectrumVisualization(analyzerNode, canvas);
    faustInstance.connect(analyzerNode);
  }

  if (connectSource) {
    // Wire up the microphone to the module, connect the module to the analyzer node, and then
    // connect the analyzer node to the audo context's output (speakers)
    const source =
      externalSource || audioContext.createMediaStreamSource(await getMicrophoneStream());
    source.connect(faustInstance);
  }

  return faustInstance;
};

export default buildInstance;
