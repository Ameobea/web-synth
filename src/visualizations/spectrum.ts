const FFT_SIZE = 2048;
const BUFFER_SIZE = FFT_SIZE / 2;
const WIDTH = 1200;
const HEIGHT_MULTIPLIER = 4;

const BUFFER = new Uint8Array(BUFFER_SIZE);
const PIXEL_BUFFER = new Uint8ClampedArray(BUFFER_SIZE * 4); // RGBA pixel data

for (let i = 0; i < PIXEL_BUFFER.length; i++) {
  PIXEL_BUFFER[i] = 255;
}

let curIx = 0;

export const initializeSpectrumVisualization = (
  analyzerNode: AnalyserNode,
  canvas: HTMLCanvasElement
) => {
  const ctx2d = canvas.getContext('2d')!;

  const updateVisualization = () => {
    curIx += 1;
    console.log(curIx);
    if (curIx >= WIDTH) {
      curIx = 0;
    }

    requestAnimationFrame(updateVisualization);

    analyzerNode.getByteFrequencyData(BUFFER);

    for (let i = 0; i < PIXEL_BUFFER.length / HEIGHT_MULTIPLIER; i += 4) {
      for (let j = 0; j < HEIGHT_MULTIPLIER; j++) {
        PIXEL_BUFFER[i * HEIGHT_MULTIPLIER + j * 4] = BUFFER[i] * 2;
        PIXEL_BUFFER[i * HEIGHT_MULTIPLIER + j * 4 + 1] = BUFFER[i] * 2;
        PIXEL_BUFFER[i * HEIGHT_MULTIPLIER + j * 4 + 2] = BUFFER[i] * 2;
      }
    }

    const imageData = new ImageData(PIXEL_BUFFER, 1, BUFFER_SIZE);
    ctx2d.putImageData(imageData, curIx, 0, 0, 0, 1, BUFFER_SIZE);
  };

  updateVisualization();
};
