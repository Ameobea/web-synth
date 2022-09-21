import * as R from 'ramda';
import React, { useCallback, useEffect, useRef } from 'react';

import { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';

export type WaveformInstance =
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

interface SampleEditorStatsProps {
  startMarkPosMs: number | null;
  endMarkPosMs: number | null;
}

const SampleEditorStats: React.FC<SampleEditorStatsProps> = ({ startMarkPosMs, endMarkPosMs }) => (
  <div className='sample-editor-stats'>
    <div className='sample-editor-stats-item'>
      <span className='sample-editor-stats-item-label'>Start</span>
      <span className='sample-editor-stats-item-value'>
        {startMarkPosMs !== null ? (startMarkPosMs * (44_100 / 1000)).toFixed(0) + ' samples' : '-'}
      </span>
    </div>
    <div className='sample-editor-stats-item'>
      <span className='sample-editor-stats-item-label'>End</span>
      <span className='sample-editor-stats-item-value'>
        {endMarkPosMs !== null ? (endMarkPosMs * (44_100 / 1000)).toFixed(0) + ' samples' : '-'}
      </span>
    </div>
  </div>
);

const SampleEditorOverlay: React.FC<{
  width: number;
  height: number;
  waveformRenderer: WaveformRenderer;
}> = ({ width, height, waveformRenderer }) => {
  const middleMouseButtonDown = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const selectionDragging = useRef(false);
  const leftMarkDragging = useRef(false);
  const rightMarkDragging = useRef(false);
  const lastDownMousePos = useRef(0);
  const startMarkElem = useRef<SVGLineElement | null>(null);
  const endMarkElem = useRef<SVGLineElement | null>(null);
  const selectionElem = useRef<SVGRectElement | null>(null);

  const updateMarkElems = useCallback(
    (bounds: { startMs: number; endMs: number }) => {
      if (bounds.endMs === 0) {
        return;
      }

      const selection = waveformRenderer.getSelection();
      if (startMarkElem.current) {
        const x = (
          R.isNil(selection.startMarkPosMs)
            ? 0
            : posToPx(
                waveformRenderer.getWidthPx(),
                bounds.startMs,
                bounds.endMs,
                selection.startMarkPosMs ?? 0
              )
        ).toString();
        startMarkElem.current.setAttribute('x1', x);
        startMarkElem.current.setAttribute('x2', x);
        startMarkElem.current.style.display = R.isNil(selection.startMarkPosMs) ? 'none' : 'inline';
      }
      if (endMarkElem.current) {
        const x = (
          R.isNil(selection.endMarkPosMs)
            ? 0
            : posToPx(
                waveformRenderer.getWidthPx(),
                bounds.startMs,
                bounds.endMs,
                selection.endMarkPosMs ?? 0
              )
        ).toString();
        endMarkElem.current.setAttribute('x1', x);
        endMarkElem.current.setAttribute('x2', x);
        endMarkElem.current.style.display = R.isNil(selection.endMarkPosMs) ? 'none' : 'inline';
      }
      if (selectionElem.current) {
        selectionElem.current.setAttribute(
          'x',
          (R.isNil(waveformRenderer.getSelection().startMarkPosMs)
            ? 0
            : posToPx(
                width,
                bounds.startMs,
                bounds.endMs,
                waveformRenderer.getSelection().startMarkPosMs!
              ) + 1
          ).toString()
        );
        selectionElem.current.setAttribute(
          'width',
          (R.isNil(waveformRenderer.getSelection().endMarkPosMs)
            ? 0
            : posToPx(
                width,
                bounds.startMs,
                bounds.endMs,
                waveformRenderer.getSelection().endMarkPosMs!
              ) -
              posToPx(
                width,
                bounds.startMs,
                bounds.endMs,
                waveformRenderer.getSelection().startMarkPosMs!
              ) -
              1
          ).toString()
        );
        selectionElem.current.style.display = R.isNil(waveformRenderer.getSelection().endMarkPosMs)
          ? 'none'
          : 'inline';
      }
    },
    [waveformRenderer, width]
  );

  useEffect(() => {
    const cb = (newBounds: { startMs: number; endMs: number }) => {
      updateMarkElems(newBounds);
    };
    waveformRenderer.addEventListener('boundsChange', cb);

    return () => waveformRenderer.removeEventListener('boundsChange', cb);
  }, [updateMarkElems, waveformRenderer]);

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

      const bounds = waveformRenderer.getBounds();
      const sampleLengthMs = waveformRenderer.getSampleLengthMs();
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
      waveformRenderer.setBounds(newStartMs, newEndMs);
    };
    document.addEventListener('mousemove', handler);

    return () => document.removeEventListener('mousemove', handler);
  }, [height, middleMouseButtonDown, width, waveformRenderer]);

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

  useEffect(() => {
    const moveHandler = (evt: MouseEvent) => {
      const diff = evt.clientX - lastDownMousePos.current;
      if (diff === 0) {
        return;
      }
      const bounds = waveformRenderer.getBounds();
      const { startMarkPosMs, endMarkPosMs } = waveformRenderer.getSelection();
      const diffMs = pxToMs(width, bounds.startMs, bounds.endMs, diff);
      const selectionWidthMs = endMarkPosMs! - startMarkPosMs!;
      const sampleLengthMs = waveformRenderer.getSampleLengthMs();

      if (selectionDragging.current) {
        let newStartMarkPosMs: number, newEndMarkPosMs: number;
        if (diff > 0) {
          newEndMarkPosMs = R.clamp(10, sampleLengthMs, endMarkPosMs! + diffMs);
          newStartMarkPosMs = R.clamp(0, sampleLengthMs - 10, newEndMarkPosMs - selectionWidthMs);
        } else {
          newStartMarkPosMs = R.clamp(0, sampleLengthMs - 10, startMarkPosMs! + diffMs);
          newEndMarkPosMs = R.clamp(10, sampleLengthMs, newStartMarkPosMs + selectionWidthMs);
        }
        waveformRenderer.setSelection({
          startMarkPosMs: newStartMarkPosMs,
          endMarkPosMs: newEndMarkPosMs,
        });
        updateMarkElems(waveformRenderer.getBounds());
      } else if (leftMarkDragging.current) {
        const newStartMarkPosMs = R.clamp(
          0,
          endMarkPosMs === null ? sampleLengthMs - 10 : endMarkPosMs - 10,
          startMarkPosMs! + diffMs
        );
        waveformRenderer.setSelection({ startMarkPosMs: newStartMarkPosMs, endMarkPosMs });
        updateMarkElems(waveformRenderer.getBounds());
      } else if (rightMarkDragging.current) {
        const newEndMarkPosMs = R.clamp(
          startMarkPosMs! + 1,
          sampleLengthMs - 1,
          endMarkPosMs! + diffMs
        );
        waveformRenderer.setSelection({ startMarkPosMs, endMarkPosMs: newEndMarkPosMs });
        updateMarkElems(waveformRenderer.getBounds());
      }

      lastDownMousePos.current = evt.clientX;
    };

    document.addEventListener('mousemove', moveHandler);
    return () => document.removeEventListener('mousemove', moveHandler);
  }, [updateMarkElems, waveformRenderer, width]);

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

  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const node = svgRef.current;
    if (!node) {
      return;
    }

    const handler = (evt: WheelEvent) => {
      const objectBounds = (evt.target as HTMLCanvasElement).getBoundingClientRect();
      const xPercent = (evt.clientX - objectBounds.left) / width;

      // Zoom in 20%, taking pixels away from the left and right side according to where the user zoomed
      const bounds = waveformRenderer.getBounds();
      const widthMs = bounds.endMs - bounds.startMs;
      const sampleLengthMs = waveformRenderer.getSampleLengthMs();
      const leftMsToAdd = xPercent * 0.2 * widthMs * (evt.deltaY > 0 ? -1 : 1);
      const rightMsToAdd = (1 - xPercent) * 0.2 * widthMs * (evt.deltaY > 0 ? 1 : -1);
      const newStartMs = R.clamp(0, Math.max(sampleLengthMs - 10, 0), bounds.startMs + leftMsToAdd);
      const newEndMs = R.clamp(newStartMs + 10, sampleLengthMs, bounds.endMs + rightMsToAdd);
      waveformRenderer.setBounds(newStartMs, newEndMs);

      evt.preventDefault();
      evt.stopPropagation();
    };

    node.addEventListener('wheel', handler);
    return () => node.removeEventListener('wheel', handler);
  }, [waveformRenderer, width]);

  // We override these against React's wishes, but the value right now is likely to be correct
  // so setting it can only help.
  const bounds = waveformRenderer.getBounds();
  const startMarkPosPx =
    bounds.endMs === 0
      ? 0
      : posToPx(
          waveformRenderer.getWidthPx(),
          bounds.startMs,
          bounds.endMs,
          waveformRenderer.getSelection().startMarkPosMs ?? 0
        ).toString();
  const endMarkPosPx =
    bounds.endMs === 0
      ? 0
      : posToPx(
          waveformRenderer.getWidthPx(),
          bounds.startMs,
          bounds.endMs,
          waveformRenderer.getSelection().endMarkPosMs ?? 0
        ).toString();

  const overlay = (
    <svg
      className='granulator-overlay'
      onClick={evt => {
        const bounds = waveformRenderer.getBounds();
        const sampleLengthMs = bounds.endMs - bounds.startMs;
        if (evt.button !== 0 || sampleLengthMs === 0) {
          return;
        }
        const { startMarkPosMs, endMarkPosMs } = waveformRenderer.getSelection();

        if (startMarkPosMs === null) {
          waveformRenderer.setSelection({
            endMarkPosMs,
            startMarkPosMs: computeClickPosMs(
              evt.currentTarget,
              evt.clientX,
              width,
              bounds.startMs,
              bounds.endMs
            ),
          });
          updateMarkElems(waveformRenderer.getBounds());
        } else if (endMarkPosMs === null) {
          const newEndMarkPosMs = computeClickPosMs(
            evt.currentTarget,
            evt.clientX,
            width,
            bounds.startMs,
            bounds.endMs
          );
          if (newEndMarkPosMs < startMarkPosMs) {
            return;
          }

          waveformRenderer.setSelection({
            startMarkPosMs,
            endMarkPosMs: newEndMarkPosMs,
          });
          updateMarkElems(waveformRenderer.getBounds());
        }
      }}
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      ref={svgRef}
    >
      <rect
        x={
          R.isNil(waveformRenderer.getSelection().startMarkPosMs) || bounds.endMs === 0
            ? 0
            : posToPx(
                width,
                bounds.startMs,
                bounds.endMs,
                waveformRenderer.getSelection().startMarkPosMs!
              ) + 1
        }
        width={
          R.isNil(waveformRenderer.getSelection().endMarkPosMs) || bounds.endMs === 0
            ? 0
            : posToPx(
                width,
                bounds.startMs,
                bounds.endMs,
                waveformRenderer.getSelection().endMarkPosMs!
              ) -
              posToPx(
                width,
                bounds.startMs,
                bounds.endMs,
                waveformRenderer.getSelection().startMarkPosMs!
              ) -
              1
        }
        y={0}
        height={height}
        className='granulator-selection-indicator'
        onMouseDown={() => {
          selectionDragging.current = true;
        }}
        style={{
          display: R.isNil(waveformRenderer.getSelection().endMarkPosMs) ? 'none' : 'inline',
        }}
        ref={selectionElem}
      />
      <line
        x1={startMarkPosPx}
        x2={startMarkPosPx}
        y1={0}
        y2={height}
        style={{
          display: R.isNil(waveformRenderer.getSelection().startMarkPosMs) ? 'none' : 'inline',
        }}
        className={'granulator-start-bar'}
        onMouseDown={evt => {
          leftMarkDragging.current = true;
          evt.stopPropagation();
        }}
        ref={startMarkElem}
      />
      <line
        x1={endMarkPosPx}
        x2={endMarkPosPx}
        y1={0}
        y2={height}
        style={{
          display: R.isNil(waveformRenderer.getSelection().endMarkPosMs) ? 'none' : 'inline',
        }}
        className={'granulator-end-bar'}
        onMouseDown={evt => {
          rightMarkDragging.current = true;
          evt.stopPropagation();
        }}
        ref={endMarkElem}
      />
    </svg>
  );

  return (
    <>
      {overlay}
      <SampleEditorStats
        startMarkPosMs={waveformRenderer.getSelection().startMarkPosMs}
        endMarkPosMs={waveformRenderer.getSelection().endMarkPosMs}
      />
    </>
  );
};

const SampleEditor: React.FC<{
  waveformRenderer: WaveformRenderer;
}> = ({ waveformRenderer }) => (
  <div
    style={{ width: waveformRenderer.getWidthPx(), height: waveformRenderer.getHeightPx() + 140 }}
    className='granulator-wrapper'
  >
    <canvas
      className='waveform-renderer'
      ref={canvas => waveformRenderer.setCanvasCtx(canvas?.getContext('2d'))}
      width={waveformRenderer.getWidthPx()}
      height={waveformRenderer.getHeightPx()}
    />
    <SampleEditorOverlay
      width={waveformRenderer.getWidthPx()}
      height={waveformRenderer.getHeightPx()}
      waveformRenderer={waveformRenderer}
    />
  </div>
);

export default SampleEditor;
