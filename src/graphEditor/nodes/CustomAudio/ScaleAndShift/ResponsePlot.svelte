<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import type { Writable } from 'svelte/store';
  import type { ResponsePlotData } from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift/ScaleAndShiftUI';

  // Constants for styling
  const PLOT_HEIGHT = 250;
  const PLOT_WIDTH = 500;
  const MARGIN = { top: 20, right: 30, bottom: 30, left: 40 };
  const INNER_WIDTH = PLOT_WIDTH - MARGIN.left - MARGIN.right;
  const INNER_HEIGHT = PLOT_HEIGHT - MARGIN.top - MARGIN.bottom;
  const LINE_COLOR = '#007bff';
  const LINE_WIDTH = 1;
  const CROSSHAIR_COLOR = '#aaaaaa77';

  export let responsePlot: Writable<ResponsePlotData | null>;

  let svg: SVGSVGElement;
  let hoveredValue: { x: number; y: number } | null = null;

  onMount(() => {
    const xScale = d3.scaleLinear().range([0, INNER_WIDTH]);
    const yScale = d3.scaleLinear().range([INNER_HEIGHT, 0]);

    const xAxis = d3.axisBottom(xScale);
    const yAxis = d3.axisLeft(yScale);

    const svgElement = d3
      .select(svg)
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    const xAxisElem = svgElement
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${INNER_HEIGHT})`);
    const yAxisElem = svgElement.append('g').attr('class', 'y-axis');

    // Add crosshair
    const crosshair = svgElement.append('g').attr('class', 'crosshair').style('display', 'none');

    crosshair
      .append('line')
      .attr('id', 'crosshairX')
      .attr('class', 'crosshair')
      .attr('stroke', CROSSHAIR_COLOR)
      .attr('y1', 0)
      .attr('y2', PLOT_HEIGHT);

    crosshair
      .append('line')
      .attr('id', 'crosshairY')
      .attr('class', 'crosshair')
      .attr('stroke', CROSSHAIR_COLOR)
      .attr('x1', 0)
      .attr('x2', PLOT_WIDTH);

    // Add a circle on the line at the same x position as the crosshair
    const crosshairCircle = crosshair
      .append('circle')
      .attr('class', 'crosshair')
      .attr('r', 2.5)
      .attr('stroke', CROSSHAIR_COLOR)
      .attr('fill', LINE_COLOR);

    const updatePlot = (data: ResponsePlotData) => {
      svgElement.selectAll('.grid').remove();
      svgElement.selectAll('.line').remove();
      svgElement.selectAll('.error-text').remove();

      const xExtent = d3.extent(data.input);
      const yExtent = d3.extent(data.output);
      if (
        xExtent[0] === undefined ||
        xExtent[1] === undefined ||
        yExtent[0] === undefined ||
        yExtent[1] === undefined
      ) {
        xAxisElem.style('display', 'none');
        yAxisElem.style('display', 'none');
        svgElement
          .append('text')
          .attr('class', 'error-text')
          .attr('x', INNER_WIDTH / 2)
          .attr('y', INNER_HEIGHT / 2)
          .attr('text-anchor', 'middle')
          .attr('fill', 'red')
          .text('Invalid Range');
        return;
      }

      xAxisElem.style('display', null);
      yAxisElem.style('display', null);

      xScale.domain(xExtent);
      yScale.domain(yExtent);

      // Update axes
      xAxisElem.call(xAxis);
      yAxisElem.call(yAxis);

      // Add grid lines
      svgElement
        .append('g')
        .attr('class', 'grid')
        .call(
          d3
            .axisLeft(yScale)
            .tickSize(-INNER_WIDTH)
            .tickFormat('' as any)
        )
        .attr('stroke-opacity', 0.1);

      svgElement
        .append('g')
        .attr('class', 'grid')
        .call(
          d3
            .axisBottom(xScale)
            .tickSize(-INNER_HEIGHT)
            .tickFormat('' as any)
        )
        .attr('transform', `translate(0,${INNER_HEIGHT})`)
        .attr('stroke-opacity', 0.1);

      svgElement
        .append('path')
        .attr('class', 'line')
        .datum(
          new Array(data.input.length)
            .fill(null)
            .map((_, i) => [data.input[i], data.output[i]] as [number, number])
        )
        .attr(
          'd',
          d3
            .line()
            .x(d => xScale(d[0]))
            .y(d => yScale(d[1]))
            .curve(d3.curveBasis)
        )
        .attr('stroke', LINE_COLOR)
        .attr('stroke-width', LINE_WIDTH)
        .attr('fill', 'none');

      // Mouse move event
      d3.select(svg)
        .on('mousemove', function (event) {
          const [rawMx, rawMy] = d3.pointer(event);
          // account for margins
          let mx = rawMx - MARGIN.left;
          let my = rawMy - MARGIN.top;
          // clamp to plot area
          mx = Math.max(0, Math.min(mx, INNER_WIDTH));
          my = Math.max(0, Math.min(my, INNER_HEIGHT));

          crosshair.style('display', null);
          crosshair.select('#crosshairX').attr('transform', `translate(${mx},0)`);
          crosshair.select('#crosshairY').attr('transform', `translate(0,${my})`);
          crosshairCircle.style('display', null);

          // read interpolated value from the series and set to the hovered value
          const x = xScale.invert(mx === 0 ? 0.0001 : mx);
          const i = d3.bisectLeft(data.input, x);
          const x0 = data.input[i - 1];
          const x1 = data.input[i];
          const y0 = data.output[i - 1];
          const y1 = data.output[i];
          const interpolatedY = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);

          crosshairCircle.attr('transform', `translate(${mx},${yScale(interpolatedY)})`);

          hoveredValue = { x, y: interpolatedY };
        })
        .on('mouseleave', function () {
          crosshair.style('display', 'none');
          crosshairCircle.style('display', 'none');
          hoveredValue = null;
        });
    };

    responsePlot.subscribe(data => {
      if (data) {
        updatePlot(data);
      }
    });
  });
</script>

<svg
  bind:this={svg}
  width={PLOT_WIDTH}
  height={PLOT_HEIGHT}
  style="border: 1px solid #888; background: #000"
></svg>
{#if hoveredValue}
  <div
    style="font-size: 13px; font-family: 'Hack'; text-align: center; padding-top: 2px; padding-bottom: 2px"
  >
    x: {hoveredValue.x.toFixed(4)}
    <br />
    y: {hoveredValue.y.toFixed(4)}
  </div>
{/if}
