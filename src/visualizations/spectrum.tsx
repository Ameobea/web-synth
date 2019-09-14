import React from 'react';
import ControlPanel from 'react-control-panel';
import chroma from 'chroma-js';

const FFT_SIZE = Math.pow(2, 14);
const BUFFER_SIZE = FFT_SIZE / 2;
const WIDTH = 1200;
const HEIGHT_MULTIPLIER = 1; // 2;

const BUFFER = new Uint8Array(BUFFER_SIZE);
const PIXEL_BUFFER = new Uint8ClampedArray(BUFFER_SIZE * 4); // RGBA pixel data

for (let i = 0; i < PIXEL_BUFFER.length; i++) {
  PIXEL_BUFFER[i] = 255;
}

let curIx = 0;

const ScalerFunctions = {
  linear: (n: number) => n,
  exponential: (n: number) => Math.pow(n, 3) / 65025,
};

const ColorFunctions = {
  pink: chroma.scale(['black', 'pink']),
};

export interface SettingsState {
  scalerFunction: keyof typeof ScalerFunctions;
  colorFunction: keyof typeof ColorFunctions;
  intensityMultiplier: number;
}

export const defaultSettingsState: SettingsState = {
  scalerFunction: 'linear',
  colorFunction: 'pink',
  intensityMultiplier: 1.2,
};

/**
 * Returns a function that can be used to set a new `options` object
 */
export const initializeSpectrumVisualization = (
  analyzerNode: AnalyserNode,
  canvas: HTMLCanvasElement,
  options: SettingsState = defaultSettingsState
) => {
  const state = { options };

  analyzerNode.fftSize = FFT_SIZE;

  const ctx2d = canvas.getContext('2d')!;

  const updateVisualization = () => {
    curIx += 1;
    if (curIx >= WIDTH) {
      curIx = 0;
    }

    requestAnimationFrame(updateVisualization);

    const scalerFn = ScalerFunctions[state.options.scalerFunction];
    const colorFn = ColorFunctions[state.options.colorFunction];

    analyzerNode.getByteFrequencyData(BUFFER);

    for (let i = 0; i < PIXEL_BUFFER.length / HEIGHT_MULTIPLIER; i += 4) {
      for (let j = 0; j < HEIGHT_MULTIPLIER; j++) {
        const value: number = scalerFn(BUFFER[i] * state.options.intensityMultiplier);
        const [r, g, b] = colorFn(value / 255).rgb();

        PIXEL_BUFFER[i * HEIGHT_MULTIPLIER + j * 4] = r;
        PIXEL_BUFFER[i * HEIGHT_MULTIPLIER + j * 4 + 1] = g;
        PIXEL_BUFFER[i * HEIGHT_MULTIPLIER + j * 4 + 2] = b;
      }
    }

    const imageData = new ImageData(PIXEL_BUFFER, 1, BUFFER_SIZE);
    ctx2d.putImageData(imageData, curIx, 0, 0, 0, 1, BUFFER_SIZE);
  };

  setTimeout(() => updateVisualization());

  return newOptions => {
    state.options = newOptions;
  };
};

export const SpectrumVisualization: React.FC<{
  settingsState: SettingsState;
  setSettingsState: (newSettings: SettingsState) => void;
}> = ({ settingsState, setSettingsState }) => (
  <ControlPanel
    state={settingsState}
    onChange={(_label: string, _value: any, newState) => {
      setSettingsState(newState);
    }}
    settings={[
      {
        type: 'select',
        label: 'scalerFunction',
        options: Object.keys(ScalerFunctions),
        initial: defaultSettingsState.scalerFunction,
      },
      {
        type: 'select',
        label: 'colorFunction',
        options: Object.keys(ColorFunctions),
        initial: defaultSettingsState.colorFunction,
      },
      {
        type: 'range',
        label: 'intensityMultiplier',
        min: 0,
        max: 4,
        steps: 100,
        initial: defaultSettingsState.intensityMultiplier,
      },
    ]}
    position={{ bottom: 180, right: 8 }}
    draggable
  />
);
