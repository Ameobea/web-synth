import React, { useCallback, useEffect, useRef } from 'react';
import { axisBottom, axisLeft, format, scaleLinear, scaleLog, select } from 'd3';

import type FMSynth from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { FilterResponseViz } from 'src/synthDesigner/filterResponseViz/FilterResponseViz';
import {
  FILTER_VIZ_DB_DOMAIN,
  FILTER_VIZ_HEIGHT,
  FILTER_VIZ_MARGIN,
  FILTER_VIZ_PLOT_HEIGHT,
  FILTER_VIZ_PLOT_WIDTH,
  FILTER_VIZ_WIDTH,
  FILTER_VIZ_X_DOMAIN,
} from 'src/synthDesigner/filterResponseViz/conf';

const AXIS_COLOR = '#555';
const TICK_TEXT_COLOR = '#999';

const drawAxes = (svgEl: SVGSVGElement) => {
  const svg = select(svgEl);
  svg.selectAll('*').remove();
  const root = svg
    .append('g')
    .attr('transform', `translate(${FILTER_VIZ_MARGIN.left},${FILTER_VIZ_MARGIN.top})`);

  const xScale = scaleLog().domain(FILTER_VIZ_X_DOMAIN).range([0, FILTER_VIZ_PLOT_WIDTH]);
  const yScale = scaleLinear().domain(FILTER_VIZ_DB_DOMAIN).range([FILTER_VIZ_PLOT_HEIGHT, 0]);

  const xAxis = axisBottom(xScale)
    .tickValues([30, 100, 300, 1_000, 3_000, 10_000])
    .tickFormat(format('~s') as any)
    .tickSize(4);
  const yAxis = axisLeft(yScale)
    .tickValues([-40, -30, -20, -10, 0, 10, 20])
    .tickFormat(d => `${d}`)
    .tickSize(4);

  // light horizontal grid lines for the dB ticks
  root
    .append('g')
    .call(
      axisLeft(yScale)
        .tickValues([-30, -20, -10, 0, 10])
        .tickSize(-FILTER_VIZ_PLOT_WIDTH)
        .tickFormat(() => '') as any
    )
    .call(g => {
      g.select('.domain').remove();
      g.selectAll('.tick line').attr('stroke', '#262626');
    });

  const xAxisG = root
    .append('g')
    .attr('transform', `translate(0,${FILTER_VIZ_PLOT_HEIGHT})`)
    .call(xAxis as any);
  const yAxisG = root.append('g').call(yAxis as any);

  for (const g of [xAxisG, yAxisG]) {
    g.select('.domain').attr('stroke', AXIS_COLOR);
    g.selectAll('.tick line').attr('stroke', AXIS_COLOR);
    g.selectAll('.tick text').attr('fill', TICK_TEXT_COLOR).attr('font-size', 9);
  }
};

interface FilterResponseVizCompProps {
  fmSynth: FMSynth;
  filterTypeId: number;
  active: boolean;
}

export const FilterResponseVizComp: React.FC<FilterResponseVizCompProps> = ({
  fmSynth,
  filterTypeId,
  active,
}) => {
  const vizRef = useRef<FilterResponseViz | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleCanvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) {
        vizRef.current?.destroy();
        vizRef.current = null;
        return;
      }
      if (vizRef.current || (window as any).isHeadless) {
        return;
      }

      const dpr = Math.max(1, Math.floor(window.devicePixelRatio) || 1);
      canvas.width = FILTER_VIZ_PLOT_WIDTH * dpr;
      canvas.height = FILTER_VIZ_PLOT_HEIGHT * dpr;
      const offscreen = canvas.transferControlToOffscreen();
      const viz = new FilterResponseViz(fmSynth, filterTypeId, active);
      viz.setCanvas(offscreen, dpr);
      vizRef.current = viz;
    },
    // intentionally created once; `filterTypeId`/`active` are pushed via the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (svgRef.current) {
      drawAxes(svgRef.current);
    }
  }, []);

  useEffect(() => void vizRef.current?.setFilterType(filterTypeId), [filterTypeId]);
  useEffect(() => void vizRef.current?.setActive(active), [active]);

  return (
    <div
      className='filter-response-viz'
      style={{
        position: 'relative',
        width: FILTER_VIZ_WIDTH,
        height: FILTER_VIZ_HEIGHT,
        background: '#0a0a0a',
      }}
    >
      <canvas
        ref={handleCanvasRef}
        style={{
          position: 'absolute',
          left: FILTER_VIZ_MARGIN.left,
          top: FILTER_VIZ_MARGIN.top,
          width: FILTER_VIZ_PLOT_WIDTH,
          height: FILTER_VIZ_PLOT_HEIGHT,
        }}
      />
      <svg
        ref={svgRef}
        width={FILTER_VIZ_WIDTH}
        height={FILTER_VIZ_HEIGHT}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
    </div>
  );
};
