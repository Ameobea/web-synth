import React, { useEffect, useRef, useState } from 'react';
import * as R from 'ramda';

import Loading from 'src/misc/Loading';
import { AsyncOnce } from 'src/util';

const BYTES_PER_F32 = 4;
const BYTES_PER_PX = 4; // RGBA

const WaveformRendererInstance = new AsyncOnce(() =>
  import('src/waveform_renderer').then(async instance => ({
    instance,
    memory: (await import('src/waveform_renderer_bg.wasm' as any)).memory,
  }))
);

type WaveformInstance =
  | {
      type: 'loaded';
      instance: typeof import('src/waveform_renderer');
      memory: typeof import('src/waveform_renderer_bg').memory;
    }
  | { type: 'loading' }
  | { type: 'notInitialized' }
  | { type: 'error'; error: string };

const renderWaveform = (
  instance: typeof import('src/waveform_renderer'),
  memory: typeof import('src/waveform_renderer_bg').memory,
  ctxPtr: number,
  startMs: number,
  endMs: number,
  widthPx: number,
  heightPx: number,
  canvasCtx: CanvasRenderingContext2D
) => {
  const imageDataPtr = instance.render_waveform(ctxPtr, startMs, endMs);
  const imageDataBuf = new Uint8ClampedArray(
    memory.buffer.slice(imageDataPtr, imageDataPtr + widthPx * heightPx * BYTES_PER_PX)
  );
  const imageData = new ImageData(imageDataBuf, widthPx, heightPx);
  canvasCtx.putImageData(imageData, 0, 0);
};

const SampleEditor: React.FC<{ sample: AudioBuffer }> = ({ sample }) => {
  const { width, height } = { width: 1400, height: 240 }; // TODO: Store as state somewhere serializable

  const sampleLengthMs = Math.trunc((sample.length / sample.sampleRate) * 1000);
  const bounds = useRef({ startMs: 0, endMs: sampleLengthMs });
  const waveformRendererCanvasCtx = useRef<CanvasRenderingContext2D | null>(null);
  const waveformRendererCtxPtr = useRef<number | null>(null);
  const [waveformRendererInstance, setWaveformRendererInstance] = useState<WaveformInstance>({
    type: 'notInitialized',
  });
  const middleMouseButtonDown = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);

  // Async-initialize a Wasm instance for the waveform renderer if it hasn't been done yet
  useEffect(() => {
    if (waveformRendererInstance.type !== 'notInitialized') {
      return;
    }

    setWaveformRendererInstance({ type: 'loading' });
    WaveformRendererInstance.get()
      .then(({ instance, memory }) =>
        setWaveformRendererInstance({ type: 'loaded', instance, memory })
      )
      .catch(err => {
        setWaveformRendererInstance({
          type: 'error',
          error: `Error initializing waveform renderer Wasm instance: ${err}`,
        });
      });
  }, [waveformRendererInstance]);

  // Create a new waveform renderer instance if we don't have one or if the sample changes
  useEffect(() => {
    if (waveformRendererInstance.type !== 'loaded') {
      return;
    }

    if (waveformRendererCtxPtr.current) {
      waveformRendererInstance.instance.free_waveform_renderer_ctx(waveformRendererCtxPtr.current);
    }

    // Create a new waveform renderer context which allocates buffers for the waveform data and output image data
    waveformRendererCtxPtr.current = waveformRendererInstance.instance.create_waveform_renderer_ctx(
      sample.length,
      sample.sampleRate,
      width,
      height
    );
    const waveformBufPtr = waveformRendererInstance.instance.get_waveform_buf_ptr(
      waveformRendererCtxPtr.current!
    );

    // Copy the sample into the buffer that the context allocated inside the Wasm memory
    const samples = sample.getChannelData(0);
    const sampleBufView = new Float32Array(waveformRendererInstance.memory.buffer);
    sampleBufView.set(samples, waveformBufPtr / BYTES_PER_F32);

    if (!waveformRendererCanvasCtx.current) {
      console.error("Created waveform renderer ctx, but canvas isn't yet initialized");
      return;
    }

    // Perform an initial render
    renderWaveform(
      waveformRendererInstance.instance,
      waveformRendererInstance.memory,
      waveformRendererCtxPtr.current,
      bounds.current.startMs,
      bounds.current.endMs,
      width,
      height,
      waveformRendererCanvasCtx.current!
    );

    // We don't want to create a new ctx every time the start or end time changes, but we need them to render for the
    // first time after creating the context
    //
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, waveformRendererInstance, width, height]);

  // Re-render and set new image data if render params change, waveform renderer ctx changes, or
  useEffect(() => {
    if (!waveformRendererCtxPtr.current || waveformRendererInstance.type !== 'loaded') {
      // Can't render if we haven't initialized a context yet.  When the context is initialized, we render
      // directly so this is OK.
      return;
    }

    renderWaveform(
      waveformRendererInstance.instance,
      waveformRendererInstance.memory,
      waveformRendererCtxPtr.current,
      bounds.current.startMs,
      bounds.current.endMs,
      width,
      height,
      waveformRendererCanvasCtx.current!
    );
  }, [waveformRendererInstance, width, height]);

  const handleCanvasScroll = (evt: WheelEvent) => {
    const objectBounds = (evt.target as HTMLCanvasElement).getBoundingClientRect();
    const xPercent = (evt.clientX - objectBounds.left) / width;

    // Zoom in 20%, taking pixels away from the left and right side according to where the user zoomed
    const widthMs = bounds.current.endMs - bounds.current.startMs;
    const leftMsToAdd = xPercent * 0.2 * widthMs * (evt.deltaY > 0 ? -1 : 1);
    const rightMsToAdd = (1 - xPercent) * 0.2 * widthMs * (evt.deltaY > 0 ? 1 : -1);
    const newStartMs = R.clamp(0, sampleLengthMs - 10, bounds.current.startMs + leftMsToAdd);
    const newEndMs = R.clamp(newStartMs + 10, sampleLengthMs, bounds.current.endMs + rightMsToAdd);
    bounds.current = { startMs: newStartMs, endMs: newEndMs };

    if (waveformRendererInstance.type === 'loaded' && waveformRendererCtxPtr.current !== null) {
      renderWaveform(
        waveformRendererInstance.instance,
        waveformRendererInstance.memory,
        waveformRendererCtxPtr.current,
        bounds.current.startMs,
        bounds.current.endMs,
        width,
        height,
        waveformRendererCanvasCtx.current!
      );
    }

    evt.preventDefault();
    evt.stopPropagation();
  };

  // Install mouse move handler if mouse button is down
  useEffect(() => {
    const handler = (evt: MouseEvent) => {
      if (!middleMouseButtonDown.current) {
        return;
      }

      const diffX = middleMouseButtonDown.current!.clientX - evt.clientX;
      if (diffX === 0) {
        return;
      }

      const msPerPx = (bounds.current.endMs - bounds.current.startMs) / width;
      const diffMs = diffX * msPerPx;

      let newStartMs: number, newEndMs: number;
      if (diffX > 0) {
        newEndMs = R.clamp(10, sampleLengthMs, bounds.current.endMs + diffMs);
        newStartMs = R.clamp(
          0,
          sampleLengthMs - 10,
          newEndMs - (bounds.current.endMs - bounds.current.startMs)
        );
      } else {
        newStartMs = R.clamp(0, sampleLengthMs - 10, bounds.current.startMs + diffMs);
        newEndMs = R.clamp(
          10,
          sampleLengthMs,
          newStartMs + (bounds.current.endMs - bounds.current.startMs)
        );
      }

      bounds.current = {
        startMs: newStartMs,
        endMs: newEndMs,
      };
      if (waveformRendererInstance.type === 'loaded' && waveformRendererCtxPtr.current !== null) {
        renderWaveform(
          waveformRendererInstance.instance,
          waveformRendererInstance.memory,
          waveformRendererCtxPtr.current,
          bounds.current.startMs,
          bounds.current.endMs,
          width,
          height,
          waveformRendererCanvasCtx.current!
        );
      }

      middleMouseButtonDown.current = { clientX: evt.clientX, clientY: evt.clientY };
    };
    document.addEventListener('mousemove', handler);

    return () => document.removeEventListener('mousemove', handler);
  }, [height, middleMouseButtonDown, sampleLengthMs, waveformRendererInstance, width]);

  // Install scroll handler
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    canvas.addEventListener('wheel', handleCanvasScroll, { passive: false });
    return () => canvas.removeEventListener('wheel', handleCanvasScroll);
  });

  if (waveformRendererInstance.type === 'error') {
    return <span style={{ color: 'red' }}>{waveformRendererInstance.error}</span>;
  } else if (waveformRendererInstance.type !== 'loaded') {
    return <Loading />;
  }

  const handleMouseDown = (evt: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => {
    if (evt.button !== 1) {
      return;
    }

    middleMouseButtonDown.current = { clientX: evt.clientX, clientY: evt.clientY };
  };
  const handleMouseUp = (evt: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => {
    if (evt.button !== 1) {
      return;
    }

    middleMouseButtonDown.current = null;
  };

  return (
    <>
      <canvas
        className='waveform-renderer'
        ref={canvas => {
          waveformRendererCanvasCtx.current = canvas?.getContext('2d') || null;
          canvasRef.current = canvas;
        }}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />
    </>
  );
};

export default SampleEditor;
