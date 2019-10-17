import { initializeSpectrumVisualization } from '../visualizations/spectrum';
import { buildFaustWorkletNode } from './FaustAudioWorklet';

const audioContext = new AudioContext();

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
  wasmInstanceArrayBuffer: ArrayBuffer,
  externalSource?: AudioScheduledSourceNode,
  connectSource = true
) => {
  const faustInstance = await buildFaustWorkletNode(audioContext, wasmInstanceArrayBuffer);

  const canvas = document.getElementById('spectrum-visualizer') as HTMLCanvasElement | undefined;
  if (canvas) {
    initializeSpectrumVisualization(analyzerNode, canvas);
    faustInstance.connect(analyzerNode);
  }

  console.log({ connectSource });
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
