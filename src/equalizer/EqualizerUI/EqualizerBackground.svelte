<script lang="ts">
  import type { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
  import d3 from '../d3';
  import { EQ_AXIS_MARGIN, EQ_X_DOMAIN, EQ_Y_DOMAIN } from 'src/equalizer/conf';

  export let inst: EqualizerInstance;
  export let containerWidth: number;
  export let containerHeight: number;
  export let stageWidth: number;
  export let stageHeight: number;
  $: vcId = inst.vcId;

  let xAxisContainer: SVGGElement;
  let yAxisContainer: SVGGElement;
  let gridContainer: SVGGElement;

  const drawAxesAndGrid = (stageWidth: number, innerHeight: number) => {
    if (stageWidth <= 0 || innerHeight <= 0) {
      return;
    }

    const xScale = d3.scaleLog().domain(EQ_X_DOMAIN).range([0, stageWidth]);
    const yScale = d3.scaleLinear().domain(EQ_Y_DOMAIN).range([innerHeight, 0]);

    const xAxis = d3.axisBottom(xScale).ticks(10, '~s');
    const yAxis = d3.axisLeft(yScale).ticks(10);

    d3.select(gridContainer).call(
      d3
        .axisLeft(yScale)
        .tickSize(-stageWidth)
        .tickFormat(() => '')
    );

    d3.select(xAxisContainer).call(xAxis);
    d3.select(yAxisContainer).call(yAxis);
  };

  $: drawAxesAndGrid(stageWidth, stageHeight);
</script>

<div class="equalizer-bg" id="equalizer-bg-{vcId}">
  <svg class="eq-mag-response-plot" width={containerWidth} height={containerHeight}>
    <g transform={`translate(${EQ_AXIS_MARGIN.left},${EQ_AXIS_MARGIN.top})`}>
      <g class="x-axis" bind:this={xAxisContainer} transform={`translate(0, ${stageHeight})`} />
      <g class="y-axis" bind:this={yAxisContainer} />
      <g class="grid" bind:this={gridContainer} />
    </g>
    <g transform={`translate(${EQ_AXIS_MARGIN.left},${EQ_AXIS_MARGIN.top})`}>
      <path class="eq-mag-response-plot-path" />
    </g>
  </svg>
</div>

<style>
  .equalizer-bg {
    height: calc(100vh - 34px);
    width: 100%;
    pointer-events: none;
  }

  .eq-mag-response-plot path {
    stroke: #cccccccc;
    fill: none;
    stroke-width: 1px;
  }

  :global(.equalizer-bg .grid) {
    stroke: #888;
    stroke-opacity: 0.1;
  }

  :global(.equalizer-bg .grid line) {
    stroke: #cccccc;
    stroke-opacity: 0.1;
  }

  :global(.equalizer-bg path, .equalizer-bg line) {
    stroke: #888;
  }

  :global(.equalizer-bg .x-axis text, .equalizer-bg .y-axis text) {
    fill: #ccc;
    font-size: 12px;
    font-family: 'IBM Plex Sans', 'Open Sans', 'Roboto', monospace, sans-serif;
  }
</style>
