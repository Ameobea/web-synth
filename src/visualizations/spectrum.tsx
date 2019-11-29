import React, { useState, useRef } from 'react';
import ControlPanel from 'react-control-panel';
import { useOnce } from 'ameo-utils';
import Loading from 'src/misc/Loading';

export interface SpectrumVizSettings {
  color_fn: number;
  scaler_fn: number;
}

const FFT_SIZE = Math.pow(2, 14);
const BUFFER_SIZE = FFT_SIZE / 2;
const WIDTH = 1200;

interface SettingDefinition {
  name: string;
  description: string | null | undefined;
  id: number;
}

export const SpectrumVisualization: React.FC<{
  initialConf?: SpectrumVizSettings;
  canvasStyle?: React.CSSProperties;
  analyzerNode: AnalyserNode;
}> = ({ initialConf, canvasStyle, analyzerNode }) => {
  const [spectrumSettingsDefinition, setSpectrumSettingsDefinition] = useState<{
    color_functions: SettingDefinition[];
    scaler_functions: SettingDefinition[];
  } | null>(null);
  const [ctxPtr, setCtxPtr] = useState<number | null>(null);
  const spectrumModule = useRef<typeof import('src/spectrum_viz') | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useOnce(async () => {
    const [spectrumVizRawModule, spectrumVizModule] = await Promise.all([
      import('src/spectrum_viz_bg'),
      import('src/spectrum_viz'),
    ] as const);
    spectrumModule.current = spectrumVizModule;
    try {
      setSpectrumSettingsDefinition(JSON.parse(spectrumModule.current.get_config_definition()));
    } catch (err) {
      console.error('Error while deserializing config from spectrum module: ', err);
      return;
    }

    const ctxPtr = spectrumModule.current.new_context(0, 0);
    setCtxPtr(ctxPtr);

    let curIx = 0;
    const ctx = {
      rawSpectrumViz: spectrumVizRawModule,
      spectrumViz: spectrumVizModule,
      wasmMemory: new Uint8Array(spectrumVizRawModule.memory.buffer),
      byteFrequencyData: new Uint8Array(BUFFER_SIZE),
      byteFrequencyDataPtr: spectrumVizModule.get_byte_frequency_data_ptr(ctxPtr),
      pixelDataPtr: spectrumVizModule.get_pixel_data_ptr(ctxPtr),
    };

    const canvas = await (async () => {
      const getCanvas = async (): Promise<HTMLCanvasElement> => {
        if (canvasRef.current) {
          return canvasRef.current;
        }

        return new Promise(resolve => setTimeout(() => getCanvas().then(resolve), 50));
      };

      return getCanvas();
    })();
    const ctx2d = canvas.getContext('2d')!;

    analyzerNode.fftSize = FFT_SIZE;

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
      ctx.spectrumViz.process_viz_data(ctxPtr);
      for (let i = 0; i < ctx.byteFrequencyData.length; i++) {
        ctx.wasmMemory![ctx.byteFrequencyDataPtr + i] = ctx.byteFrequencyData[i];
      }

      const imageData = new ImageData(
        new Uint8ClampedArray(
          ctx.rawSpectrumViz.memory.buffer.slice(
            ctx.pixelDataPtr,
            ctx.pixelDataPtr + BUFFER_SIZE * 4
          )
        ),
        1,
        BUFFER_SIZE
      );
      ctx2d.putImageData(imageData, curIx, 0, 0, 0, 1, BUFFER_SIZE);

      requestAnimationFrame(updateVisualization);
    };

    setTimeout(updateVisualization);
  });

  return (
    <>
      {!spectrumSettingsDefinition || !spectrumModule.current || ctxPtr === null ? (
        <Loading />
      ) : (
        <ControlPanel
          state={initialConf}
          onChange={(_label: string, _value: any, { color_fn, scaler_fn }: SpectrumVizSettings) =>
            spectrumModule.current!.set_conf(ctxPtr, +color_fn, +scaler_fn)
          }
          settings={[
            {
              type: 'select',
              label: 'scaler_fn',
              options: spectrumSettingsDefinition.scaler_functions.reduce(
                (acc, { id, name }) => ({ ...acc, [name]: id }),
                {}
              ),
              initial: spectrumSettingsDefinition.scaler_functions[0].id,
            },
            {
              type: 'select',
              label: 'color_fn',
              options: spectrumSettingsDefinition.color_functions.reduce(
                (acc, { id, name }) => ({ ...acc, [name]: id }),
                {}
              ),
              initial: spectrumSettingsDefinition.color_functions[0].id,
            },
          ]}
          position={{ bottom: 180, right: 8 }}
          draggable
        />
      )}

      <canvas
        ref={canvasRef}
        width={1200}
        height={1024}
        id='spectrum-visualizer'
        style={{
          backgroundColor: '#000',
          imageRendering: 'crisp-edges',
          ...(canvasStyle || {}),
        }}
      />
    </>
  );
};
