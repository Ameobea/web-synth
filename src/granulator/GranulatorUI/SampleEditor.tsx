import * as R from 'ramda';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';

export type WaveformInstance =
  | {
      type: 'loaded';
      instance: typeof import('src/waveform_renderer');
      memory: WebAssembly.Memory;
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

interface SampleEditorOverlayProps {
  width: number;
  height: number;
  waveformRenderer: WaveformRenderer;
  disabled?: boolean;
}

interface DragState {
  selectionDragging: boolean;
  leftMarkDragging: boolean;
  rightMarkDragging: boolean;
  lastMousePos: number;
  startMarkElem: SVGLineElement | null;
  endMarkElem: SVGLineElement | null;
  selectionElem: SVGRectElement | null;
  dragStartPos: { clientX: number; clientY: number } | null;
}

const SampleEditorOverlay: React.FC<SampleEditorOverlayProps> = ({
  width,
  height,
  waveformRenderer,
  disabled,
}) => {
  const dragState = useRef<DragState>({
    selectionDragging: false,
    leftMarkDragging: false,
    rightMarkDragging: false,
    lastMousePos: 0,
    startMarkElem: null,
    endMarkElem: null,
    selectionElem: null,
    dragStartPos: null,
  });

  const [bounds, setBounds] = useState(waveformRenderer.getBounds());
  const [selection, setSelection] = useState(waveformRenderer.getSelection());
  useEffect(() => {
    const boundsChangeCb = (newBounds: { startMs: number; endMs: number }) =>
      void setBounds(newBounds);
    waveformRenderer.addEventListener('boundsChange', boundsChangeCb);

    const selectionChangeCb = (newSelection: {
      startMarkPosMs: number | null;
      endMarkPosMs: number | null;
    }) => void setSelection(newSelection);
    waveformRenderer.addEventListener('selectionChange', selectionChangeCb);

    return () => {
      waveformRenderer.removeEventListener('boundsChange', boundsChangeCb);
      waveformRenderer.removeEventListener('selectionChange', selectionChangeCb);
    };
  }, [waveformRenderer]);

  // mouse move handler for panning
  useEffect(() => {
    const handler = (evt: MouseEvent) => {
      if (!dragState.current.dragStartPos) {
        return;
      }

      const diffX = dragState.current.dragStartPos.clientX - evt.clientX;
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

      dragState.current.dragStartPos = { clientX: evt.clientX, clientY: evt.clientY };
      waveformRenderer.setBounds(newStartMs, newEndMs);
    };
    document.addEventListener('mousemove', handler);

    return () => document.removeEventListener('mousemove', handler);
  }, [height, width, waveformRenderer]);

  const handleMouseDown = useCallback((evt: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (evt.button !== 1) {
      return;
    }

    dragState.current.dragStartPos = { clientX: evt.clientX, clientY: evt.clientY };
  }, []);
  const handleMouseUp = useCallback((evt: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (evt.button !== 1) {
      return;
    }

    dragState.current.dragStartPos = null;
  }, []);

  // mouse move handler for moving + resizing selection
  useEffect(() => {
    const moveHandler = (evt: MouseEvent) => {
      const diff = evt.clientX - dragState.current.lastMousePos;
      dragState.current.lastMousePos = evt.clientX;

      if (disabled) {
        return;
      }

      const anyDragging =
        dragState.current.selectionDragging ||
        dragState.current.leftMarkDragging ||
        dragState.current.rightMarkDragging;
      if (!anyDragging) {
        return;
      }

      if (diff === 0) {
        return;
      }

      const bounds = waveformRenderer.getBounds();
      const { startMarkPosMs, endMarkPosMs } = waveformRenderer.getSelection();
      const diffMs = pxToMs(width, bounds.startMs, bounds.endMs, diff);
      const selectionWidthMs = endMarkPosMs! - startMarkPosMs!;
      const sampleLengthMs = waveformRenderer.getSampleLengthMs();

      if (dragState.current.selectionDragging) {
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
      } else if (dragState.current.leftMarkDragging) {
        const newStartMarkPosMs = R.clamp(
          0,
          endMarkPosMs === null ? sampleLengthMs - 10 : endMarkPosMs - 10,
          startMarkPosMs! + diffMs
        );
        waveformRenderer.setSelection({ startMarkPosMs: newStartMarkPosMs, endMarkPosMs });
      } else if (dragState.current.rightMarkDragging) {
        const newEndMarkPosMs = R.clamp(
          startMarkPosMs! + 1,
          sampleLengthMs - 1,
          endMarkPosMs! + diffMs
        );
        waveformRenderer.setSelection({ startMarkPosMs, endMarkPosMs: newEndMarkPosMs });
      }
    };

    document.addEventListener('mousemove', moveHandler);
    return () => document.removeEventListener('mousemove', moveHandler);
  }, [waveformRenderer, width, disabled]);

  useEffect(() => {
    const mouseUpHandler = () => {
      dragState.current.selectionDragging = false;
      dragState.current.leftMarkDragging = false;
      dragState.current.rightMarkDragging = false;
    };

    document.addEventListener('mouseup', mouseUpHandler);
    return () => void document.removeEventListener('mouseup', mouseUpHandler);
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

      // Zoom in 12%, taking pixels away from the left and right side according to where the user zoomed
      const bounds = waveformRenderer.getBounds();
      const widthMs = bounds.endMs - bounds.startMs;
      const sampleLengthMs = waveformRenderer.getSampleLengthMs();
      const leftMsToAdd = xPercent * 0.12 * widthMs * (evt.deltaY > 0 ? -1 : 1);
      const rightMsToAdd = (1 - xPercent) * 0.12 * widthMs * (evt.deltaY > 0 ? 1 : -1);
      const newStartMs = R.clamp(0, Math.max(sampleLengthMs - 10, 0), bounds.startMs + leftMsToAdd);
      const newEndMs = R.clamp(newStartMs + 10, sampleLengthMs, bounds.endMs + rightMsToAdd);
      waveformRenderer.setBounds(newStartMs, newEndMs);

      evt.preventDefault();
      evt.stopPropagation();
    };

    node.addEventListener('wheel', handler);
    return () => node.removeEventListener('wheel', handler);
  }, [waveformRenderer, width]);

  const startMarkPosPx =
    bounds.endMs === 0
      ? 0
      : posToPx(
          waveformRenderer.getWidthPx(),
          bounds.startMs,
          bounds.endMs,
          selection.startMarkPosMs ?? 0
        ).toString();
  const endMarkPosPx =
    bounds.endMs === 0
      ? 0
      : posToPx(
          waveformRenderer.getWidthPx(),
          bounds.startMs,
          bounds.endMs,
          selection.endMarkPosMs ?? 0
        ).toString();

  const overlay = (
    <svg
      className='granulator-overlay'
      onClick={evt => {
        if (disabled) {
          return;
        }

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
          R.isNil(selection.startMarkPosMs) || bounds.endMs === 0
            ? 0
            : posToPx(width, bounds.startMs, bounds.endMs, selection.startMarkPosMs!) + 1
        }
        width={
          R.isNil(selection.endMarkPosMs) || bounds.endMs === 0
            ? 0
            : posToPx(width, bounds.startMs, bounds.endMs, selection.endMarkPosMs!) -
              posToPx(width, bounds.startMs, bounds.endMs, selection.startMarkPosMs!) -
              1
        }
        y={0}
        height={height}
        className='granulator-selection-indicator'
        onMouseDown={() => {
          dragState.current.selectionDragging = true;
        }}
        style={{
          display: R.isNil(selection.endMarkPosMs) ? 'none' : 'inline',
        }}
        ref={(elem: SVGRectElement | null) => {
          dragState.current.selectionElem = elem;
        }}
      />
      <line
        x1={startMarkPosPx}
        x2={startMarkPosPx}
        y1={0}
        y2={height}
        style={{
          display: R.isNil(selection.startMarkPosMs) ? 'none' : 'inline',
        }}
        className='granulator-start-bar'
        onMouseDown={evt => {
          dragState.current.leftMarkDragging = true;
          evt.stopPropagation();
        }}
        ref={startMarkElem => {
          dragState.current.startMarkElem = startMarkElem;
        }}
      />
      <line
        x1={endMarkPosPx}
        x2={endMarkPosPx}
        y1={0}
        y2={height}
        style={{
          display: R.isNil(selection.endMarkPosMs) ? 'none' : 'inline',
        }}
        className='granulator-end-bar'
        onMouseDown={evt => {
          dragState.current.rightMarkDragging = true;
          evt.stopPropagation();
        }}
        ref={endMarkElem => {
          dragState.current.endMarkElem = endMarkElem;
        }}
      />
    </svg>
  );

  return (
    <>
      {overlay}
      <SampleEditorStats
        startMarkPosMs={selection.startMarkPosMs}
        endMarkPosMs={selection.endMarkPosMs}
      />
    </>
  );
};

interface SampleEditorProps {
  waveformRenderer: WaveformRenderer;
  disabled?: boolean;
  style?: React.CSSProperties;
}

const SampleEditor: React.FC<SampleEditorProps> = ({ waveformRenderer, disabled, style }) => (
  <div
    style={{
      width: waveformRenderer.getWidthPx(),
      height: waveformRenderer.getHeightPx() + 140,
      position: 'relative',
      ...(style ?? {}),
    }}
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
      disabled={disabled}
    />
  </div>
);

export default SampleEditor;
