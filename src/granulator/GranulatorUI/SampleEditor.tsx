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

const posToPx = (widthPx: number, startMs: number, endMs: number, posMs: number) => {
  const xPercent = (posMs - startMs) / (endMs - startMs);
  return xPercent * widthPx;
};
const pxToMs = (widthPx: number, startMs: number, endMs: number, val: number) => {
  const widthMs = endMs - startMs;
  return (widthMs / widthPx) * val;
};

const PosIndicator: React.FC<{
  width: number;
  height: number;
  startMs: number;
  endMs: number;
  posMs: number;
  isStart: boolean;
  onMouseDown: (evt: React.MouseEvent<SVGLineElement, MouseEvent>) => void;
}> = ({ width, height, startMs, endMs, posMs, isStart, onMouseDown }) => {
  const x = posToPx(width, startMs, endMs, posMs);

  return (
    <line
      x1={x}
      x2={x}
      y1={0}
      y2={height}
      className={isStart ? 'granulator-start-bar' : 'granulator-end-bar'}
      onMouseDown={onMouseDown}
    />
  );
};

const computeClickPosMs = (
  svg: SVGSVGElement,
  clientX: number,
  widthPx: number,
  startMs: number,
  endMs: number
): number => {
  const bounds = svg.getBoundingClientRect();
  const x = clientX - bounds.left;
  const xPercent = x / widthPx;
  const widthMs = endMs - startMs;
  return startMs + widthMs * xPercent;
};

const SampleEditorOverlay: React.FC<{
  width: number;
  height: number;
  sample: AudioBuffer;
  onBoundsChange: (newBounds: { startMs: number; endMs: number }) => void;
}> = ({ width, height, sample, onBoundsChange }) => {
  const [{ startMarkPosMs, endMarkPosMs }, setMarkPositions] = useState<{
    startMarkPosMs: number | null;
    endMarkPosMs: number | null;
  }>({ startMarkPosMs: null, endMarkPosMs: null });
  const middleMouseButtonDown = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const sampleLengthMs = Math.trunc((sample.length / sample.sampleRate) * 1000);
  const selectionDragging = useRef(false);
  const leftMarkDragging = useRef(false);
  const rightMarkDragging = useRef(false);
  const lastDownMousePos = useRef<number>(0);

  const [bounds, setBounds] = useState({ startMs: 0, endMs: sampleLengthMs });
  useEffect(() => {
    setTimeout(() => onBoundsChange(bounds));
  }, [bounds, sample, onBoundsChange]);
  useEffect(() => {
    const sampleLengthMs = (sample.length / sample.sampleRate) * 1000;
    if (sampleLengthMs < bounds.startMs || sampleLengthMs < bounds.endMs) {
      setBounds({ startMs: 0, endMs: Math.trunc(sampleLengthMs) });
    }
  }, [bounds.endMs, bounds.startMs, sample]);

  // Install scroll handler
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!svgRef.current) {
      return;
    }

    const handleCanvasScroll = (evt: WheelEvent) => {
      const objectBounds = (evt.target as HTMLCanvasElement).getBoundingClientRect();
      const xPercent = (evt.clientX - objectBounds.left) / width;

      // Zoom in 20%, taking pixels away from the left and right side according to where the user zoomed
      const widthMs = bounds.endMs - bounds.startMs;
      const leftMsToAdd = xPercent * 0.2 * widthMs * (evt.deltaY > 0 ? -1 : 1);
      const rightMsToAdd = (1 - xPercent) * 0.2 * widthMs * (evt.deltaY > 0 ? 1 : -1);
      const newStartMs = R.clamp(0, sampleLengthMs - 10, bounds.startMs + leftMsToAdd);
      const newEndMs = R.clamp(newStartMs + 10, sampleLengthMs, bounds.endMs + rightMsToAdd);
      setBounds({ startMs: newStartMs, endMs: newEndMs });

      evt.preventDefault();
      evt.stopPropagation();
    };

    const svg = svgRef.current;
    svg.addEventListener('wheel', handleCanvasScroll, { passive: false });
    return () => svg.removeEventListener('wheel', handleCanvasScroll);
  });

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

      const msPerPx = (bounds.endMs - bounds.startMs) / width;
      const diffMs = diffX * msPerPx;

      let newStartMs: number, newEndMs: number;
      if (diffX > 0) {
        newEndMs = R.clamp(10, sampleLengthMs, bounds.endMs + diffMs);
        newStartMs = R.clamp(0, sampleLengthMs - 10, newEndMs - (bounds.endMs - bounds.startMs));
      } else {
        newStartMs = R.clamp(0, sampleLengthMs - 10, bounds.startMs + diffMs);
        newEndMs = R.clamp(10, sampleLengthMs, newStartMs + (bounds.endMs - bounds.startMs));
      }

      middleMouseButtonDown.current = { clientX: evt.clientX, clientY: evt.clientY };
      setBounds({ startMs: newStartMs, endMs: newEndMs });
    };
    document.addEventListener('mousemove', handler);

    return () => document.removeEventListener('mousemove', handler);
  }, [bounds.endMs, bounds.startMs, height, middleMouseButtonDown, sampleLengthMs, width]);

  const handleMouseDown = (evt: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (evt.button !== 1) {
      return;
    }

    middleMouseButtonDown.current = { clientX: evt.clientX, clientY: evt.clientY };
  };
  const handleMouseUp = (evt: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (evt.button !== 1) {
      return;
    }

    middleMouseButtonDown.current = null;
  };

  const posBarBaseProps = {
    width,
    height,
    ...bounds,
  };

  useEffect(() => {
    const moveHandler = (evt: MouseEvent) => {
      const diff = evt.clientX - lastDownMousePos.current;
      if (diff === 0) {
        return;
      }
      const diffMs = pxToMs(width, bounds.startMs, bounds.endMs, diff);
      const selectionWidthMs = endMarkPosMs! - startMarkPosMs!;

      if (selectionDragging.current) {
        let newStartMarkPosMs: number, newEndMarkPosMs: number;
        if (diff > 0) {
          newEndMarkPosMs = R.clamp(10, sampleLengthMs, endMarkPosMs! + diffMs);
          newStartMarkPosMs = R.clamp(0, sampleLengthMs - 10, newEndMarkPosMs - selectionWidthMs);
        } else {
          newStartMarkPosMs = R.clamp(0, sampleLengthMs - 10, startMarkPosMs! + diffMs);
          newEndMarkPosMs = R.clamp(10, sampleLengthMs, newStartMarkPosMs + selectionWidthMs);
        }
        setMarkPositions({ startMarkPosMs: newStartMarkPosMs, endMarkPosMs: newEndMarkPosMs });
      } else if (leftMarkDragging.current) {
        const newStartMarkPosMs = R.clamp(
          0,
          endMarkPosMs === null ? sampleLengthMs - 10 : endMarkPosMs - 10,
          startMarkPosMs! + diffMs
        );
        setMarkPositions({ endMarkPosMs, startMarkPosMs: newStartMarkPosMs });
      } else if (rightMarkDragging.current) {
        const newEndMarkPosMs = R.clamp(
          startMarkPosMs! + 10,
          sampleLengthMs - 10,
          endMarkPosMs! + diffMs
        );
        setMarkPositions({ endMarkPosMs: newEndMarkPosMs, startMarkPosMs });
      }

      lastDownMousePos.current = evt.clientX;
    };

    document.addEventListener('mousemove', moveHandler);
    return () => {
      document.removeEventListener('mousemove', moveHandler);
    };
  });

  useEffect(() => {
    const mouseDownHandler = (evt: MouseEvent) => {
      lastDownMousePos.current = evt.clientX;
    };

    const mouseUpHandler = () => {
      selectionDragging.current = false;
      leftMarkDragging.current = false;
      rightMarkDragging.current = false;
    };

    document.addEventListener('mouseup', mouseUpHandler);
    document.addEventListener('mouseup', mouseDownHandler);
    return () => {
      document.removeEventListener('mouseup', mouseUpHandler);
      document.removeEventListener('mouseup', mouseDownHandler);
    };
  }, []);

  return (
    <svg
      className='granulator-overlay'
      onClick={evt => {
        if (evt.button !== 0) {
          return;
        }

        if (startMarkPosMs === null) {
          setMarkPositions({
            endMarkPosMs,
            startMarkPosMs: computeClickPosMs(
              evt.currentTarget,
              evt.clientX,
              width,
              bounds.startMs,
              bounds.endMs
            ),
          });
        } else if (endMarkPosMs === null) {
          setMarkPositions({
            startMarkPosMs,
            endMarkPosMs: computeClickPosMs(
              evt.currentTarget,
              evt.clientX,
              width,
              bounds.startMs,
              bounds.endMs
            ),
          });
        }
      }}
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      ref={svgRef}
    >
      {startMarkPosMs !== null && endMarkPosMs !== null ? (
        <rect
          x={posToPx(width, bounds.startMs, bounds.endMs, startMarkPosMs) + 1}
          y={0}
          width={
            posToPx(width, bounds.startMs, bounds.endMs, endMarkPosMs) -
            posToPx(width, bounds.startMs, bounds.endMs, startMarkPosMs) -
            1
          }
          height={height}
          className='granulator-selection-indicator'
          onMouseDown={() => {
            selectionDragging.current = true;
          }}
        />
      ) : null}
      {startMarkPosMs === null ? null : (
        <PosIndicator
          {...posBarBaseProps}
          posMs={startMarkPosMs}
          isStart
          onMouseDown={evt => {
            leftMarkDragging.current = true;
            evt.stopPropagation();
          }}
        />
      )}
      {endMarkPosMs === null ? null : (
        <PosIndicator
          {...posBarBaseProps}
          posMs={endMarkPosMs}
          isStart={false}
          onMouseDown={evt => {
            rightMarkDragging.current = true;
            evt.stopPropagation();
          }}
        />
      )}
    </svg>
  );
};

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

  const onBoundsChange = (newBounds: { startMs: number; endMs: number }) => {
    bounds.current = newBounds;
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
  };

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

  if (waveformRendererInstance.type === 'error') {
    return <span style={{ color: 'red' }}>{waveformRendererInstance.error}</span>;
  } else if (waveformRendererInstance.type !== 'loaded') {
    return <Loading />;
  }

  return (
    <div style={{ width, height }} className='granulator-wrapper'>
      <canvas
        className='waveform-renderer'
        ref={canvas => {
          waveformRendererCanvasCtx.current = canvas?.getContext('2d') || null;
        }}
        width={width}
        height={height}
      />
      <SampleEditorOverlay
        sample={sample}
        width={width}
        height={height}
        onBoundsChange={onBoundsChange}
      />
    </div>
  );
};

export default SampleEditor;
