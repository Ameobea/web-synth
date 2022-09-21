import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';

import Loading from 'src/misc/Loading';
import { getSentry } from 'src/sentry';
import { AsyncOnce, elemInView } from 'src/util';

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

const RawWasmModule = new AsyncOnce(() =>
  (import('src/spectrum_viz_bg.wasm' as any) as Promise<{ memory: WebAssembly.Memory }>).then(
    wasmModule => {
      type Return = typeof wasmModule & { wasmMemory: Uint8Array };
      (wasmModule as any).wasmMemory = new Uint8Array(wasmModule.memory.buffer);
      return wasmModule as Return;
    }
  )
);

const WasmModule = new AsyncOnce(() => import('src/spectrum_viz'));

interface SpectrumVisualizationProps {
  initialConf?: SpectrumVizSettings;
  canvasStyle?: React.CSSProperties;
  controlPanelStyle?: React.CSSProperties;
  controlPanelDraggable?: boolean;
  analyzerNode: AnalyserNode;
  paused: boolean;
  height?: number;
  children?: React.ReactNode;
}

const SpectrumVisualizationInner: React.FC<SpectrumVisualizationProps> = ({
  initialConf,
  canvasStyle,
  controlPanelStyle,
  controlPanelDraggable,
  analyzerNode,
  paused,
  height = 1024,
  children,
}) => {
  const [spectrumSettingsDefinition, setSpectrumSettingsDefinition] = useState<{
    color_functions: SettingDefinition[];
    scaler_functions: SettingDefinition[];
  } | null>(null);
  const [ctxPtr, setCtxPtr] = useState<number | null>(null);
  const spectrumModule = useRef<typeof import('src/spectrum_viz') | null>(null);
  const [canvasRef, setCanvasRef] = useState<null | HTMLCanvasElement>(null);
  const [mkUpdateViz, setMkUpdateViz] = useState<
    ((ctx2D: CanvasRenderingContext2D) => () => void) | null
  >(null);
  const animationFrameHandle = useRef<number | null>(null);
  const lockedHeight = useRef(height);
  const isInView = useRef(true);

  useEffect(() => {
    const cb = () => {
      isInView.current = canvasRef ? elemInView(canvasRef) : false;
    };
    const intervalHandle = setInterval(cb, 230);

    return () => clearInterval(intervalHandle);
  }, [canvasRef]);

  useEffect(() => {
    if (paused && animationFrameHandle.current !== null) {
      cancelAnimationFrame(animationFrameHandle.current);
      animationFrameHandle.current = null;
    } else if (!paused && mkUpdateViz && canvasRef && animationFrameHandle.current === null) {
      const ctx2d = canvasRef.getContext('2d')!;
      animationFrameHandle.current = requestAnimationFrame(mkUpdateViz(ctx2d));
    }
  }, [mkUpdateViz, canvasRef, paused]);

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) {
      return;
    }
    didInit.current = true;

    (async () => {
      const [spectrumVizRawModule, spectrumVizModule] = await Promise.all([
        RawWasmModule.get(),
        WasmModule.get(),
      ] as const);
      spectrumModule.current = spectrumVizModule;
      try {
        setSpectrumSettingsDefinition(JSON.parse(spectrumModule.current.get_config_definition()));
      } catch (err) {
        console.error('Error while deserializing config from spectrum module: ', err);
        return;
      }

      const ctxPtr = spectrumModule.current.new_context(2, 1);
      if (initialConf) {
        spectrumModule.current!.set_conf(ctxPtr, initialConf.color_fn, initialConf.scaler_fn);
      }
      setCtxPtr(ctxPtr);

      let curIx = 0;
      const pixelDataPtr = spectrumVizModule.get_pixel_data_ptr(ctxPtr);
      const ctx = {
        rawSpectrumViz: spectrumVizRawModule,
        spectrumViz: spectrumVizModule,
        wasmMemory: spectrumVizRawModule.wasmMemory,
        byteFrequencyData: new Uint8Array(BUFFER_SIZE),
        byteFrequencyDataPtr: spectrumVizModule.get_byte_frequency_data_ptr(ctxPtr),
        pixelDataPtr,
        pixelDataBuf: new Uint8ClampedArray(
          spectrumVizRawModule.memory.buffer.slice(pixelDataPtr, pixelDataPtr + BUFFER_SIZE * 4)
        ),
      };

      analyzerNode.fftSize = FFT_SIZE;

      const mkUpdateVisualization = (ctx2D: CanvasRenderingContext2D) => {
        isInView.current = elemInView(ctx2D.canvas);

        const updateViz = () => {
          if (ctx === null || !isInView.current) {
            animationFrameHandle.current = requestAnimationFrame(updateViz);
            return;
          }

          curIx += 1;
          if (curIx >= WIDTH) {
            curIx = 0;
          }

          analyzerNode.getByteFrequencyData(ctx.byteFrequencyData);
          ctx.spectrumViz.process_viz_data(ctxPtr);
          if (ctx.wasmMemory.buffer !== ctx.rawSpectrumViz.memory.buffer) {
            // Memory grown/re-allocated?
            ctx.wasmMemory = new Uint8Array(ctx.rawSpectrumViz.memory.buffer);
          }
          ctx.wasmMemory.set(ctx.byteFrequencyData, ctx.byteFrequencyDataPtr);

          if (ctx.pixelDataBuf.buffer !== ctx.rawSpectrumViz.memory.buffer) {
            // Memory grown/re-allocated?
            ctx.pixelDataBuf = new Uint8ClampedArray(
              spectrumVizRawModule.memory.buffer.slice(
                pixelDataPtr + (BUFFER_SIZE - lockedHeight.current) * 4,
                pixelDataPtr + (BUFFER_SIZE - lockedHeight.current) * 4 + lockedHeight.current * 4
              )
            );
          }
          const imageData = new ImageData(ctx.pixelDataBuf, 1, lockedHeight.current);
          ctx2D.putImageData(imageData, curIx, 0, 0, 0, 1, lockedHeight.current);

          animationFrameHandle.current = requestAnimationFrame(updateViz);
        };

        return updateViz;
      };

      // If the state being set is a function, it is called to produce the new state value.
      // Since we actually want to store the function as state, we use this wrapper function
      // in order to prevent our function from getting called rather than set.
      setMkUpdateViz(() => mkUpdateVisualization);
    })();
  }, [analyzerNode, initialConf]);

  const onSettingChange = useCallback(
    (_label: string, _value: any, { color_fn, scaler_fn }: SpectrumVizSettings) => {
      getSentry()?.captureMessage('Spectrum viz change settings', {
        extra: { color_fn, scaler_fn },
      });
      spectrumModule.current!.set_conf(ctxPtr!, +color_fn, +scaler_fn);
    },
    [ctxPtr]
  );

  const settings = useMemo(() => {
    if (!spectrumSettingsDefinition) {
      return [];
    }

    return [
      {
        type: 'select',
        label: 'scaler_fn',
        options: spectrumSettingsDefinition.scaler_functions.reduce(
          (acc, { id, name }) => ({ ...acc, [name]: id }),
          {}
        ),
        initial: 1,
      },
      {
        type: 'select',
        label: 'color_fn',
        options: spectrumSettingsDefinition.color_functions.reduce(
          (acc, { id, name }) => ({ ...acc, [name]: id }),
          {}
        ),
        initial: 2,
      },
    ];
  }, [spectrumSettingsDefinition]);

  return (
    <>
      {!spectrumSettingsDefinition || !spectrumModule.current || ctxPtr === null ? (
        <Loading />
      ) : (
        <ControlPanel
          onChange={onSettingChange}
          settings={settings}
          draggable={controlPanelDraggable ?? true}
          style={controlPanelStyle}
        />
      )}

      {children}
      <canvas
        ref={ref => {
          if (ref !== canvasRef) {
            setCanvasRef(ref);
          }
        }}
        width={WIDTH}
        height={lockedHeight.current}
        style={{
          backgroundColor: '#000',
          imageRendering: 'crisp-edges',
          ...(canvasStyle || {}),
        }}
      />
    </>
  );
};

export const SpectrumVisualization = React.memo(SpectrumVisualizationInner);
