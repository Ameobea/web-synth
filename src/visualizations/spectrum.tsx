import React from 'react';
import ControlPanel from 'react-control-panel';

const FFT_SIZE = Math.pow(2, 14);
const BUFFER_SIZE = FFT_SIZE / 2;
const WIDTH = 1200;

/**
 * Returns a function that can be used to set a new `options` object
 */
export const initializeSpectrumVisualization = (
  analyzerNode: AnalyserNode,
  canvas: HTMLCanvasElement,
  options: unknown
) => {
  const state = { options };

  analyzerNode.fftSize = FFT_SIZE;

  const ctx2d = canvas.getContext('2d')!;

  let curIx = 0;
  let ctx: {
    rawSpectrumViz: typeof import('src/spectrum_viz_bg');
    spectrumViz: typeof import('src/spectrum_viz');
    spectrumVizCtxPtr: number;
    wasmMemory: Uint8Array;
    byteFrequencyData: Uint8Array;
    byteFrequencyDataPtr: number;
    pixelDataPtr: number;
  } | null = null;
  Promise.all([import('src/spectrum_viz_bg'), import('src/spectrum_viz')] as const).then(
    ([spectrumVizRawModule, spectrumVizModule]) => {
      const spectrumVizCtxPtr = spectrumVizModule.new_context(0);
      ctx = {
        rawSpectrumViz: spectrumVizRawModule,
        spectrumViz: spectrumVizModule,
        spectrumVizCtxPtr,
        wasmMemory: new Uint8Array(spectrumVizRawModule.memory.buffer),
        byteFrequencyData: new Uint8Array(BUFFER_SIZE),
        byteFrequencyDataPtr: spectrumVizModule.get_byte_frequency_data_ptr(spectrumVizCtxPtr),
        pixelDataPtr: spectrumVizModule.get_pixel_data_ptr(spectrumVizCtxPtr),
      };
    }
  );

  const updateVisualization = () => {
    if (ctx === null) {
      requestAnimationFrame(updateVisualization);
      return;
    }

    curIx += 1;
    if (curIx >= WIDTH) {
      curIx = 0;
    }

    analyzerNode.getByteFrequencyData(ctx.byteFrequencyData);
    ctx.spectrumViz.process_viz_data(ctx.spectrumVizCtxPtr);
    for (let i = 0; i < ctx.byteFrequencyData.length; i++) {
      ctx.wasmMemory![ctx.byteFrequencyDataPtr + i] = ctx.byteFrequencyData[i];
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(
        ctx.rawSpectrumViz.memory.buffer.slice(ctx.pixelDataPtr, ctx.pixelDataPtr + BUFFER_SIZE * 4)
      ),
      1,
      BUFFER_SIZE
    );
    ctx2d.putImageData(imageData, curIx, 0, 0, 0, 1, BUFFER_SIZE);

    requestAnimationFrame(updateVisualization);
  };

  setTimeout(updateVisualization);

  return (newOptions: unknown) => {
    state.options = newOptions;
  };
};

export const SpectrumVisualization: React.FC<{
  settingsState: unknown;
  setSettingsState: (newSettings: unknown) => void;
}> = ({ settingsState, setSettingsState }) => (
  <ControlPanel
    state={settingsState}
    onChange={(_label: string, _value: any, newState: unknown) => {
      setSettingsState(newState);
    }}
    settings={
      [
        // TODO
        // {
        //   type: 'select',
        //   label: 'scalerFunction',
        //   options: Object.keys(ScalerFunctions),
        //   initial: defaultSettingsState.scalerFunction,
        // },
        // {
        //   type: 'select',
        //   label: 'colorFunction',
        //   options: Object.keys(ColorFunctions),
        //   initial: defaultSettingsState.colorFunction,
        // },
        // {
        //   type: 'range',
        //   label: 'intensityMultiplier',
        //   min: 0,
        //   max: 4,
        //   steps: 100,
        //   initial: defaultSettingsState.intensityMultiplier,
        // },
      ]
    }
    position={{ bottom: 180, right: 8 }}
    draggable
  />
);
