<script lang="ts">
  import type { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
  import d3 from '../d3';
  import { EQ_AXIS_MARGIN, EQ_X_DOMAIN, EQ_GAIN_DOMAIN, EQ_Q_DOMAIN } from 'src/equalizer/conf';
  import type { EqualizerBand } from 'src/equalizer/equalizer';
  import { EqualizerFilterType, getEqAxes } from 'src/equalizer/eqHelpers';
  import LineSpectrogramUi from 'src/visualizations/LineSpectrogram/LineSpectrogramUI.svelte';
  import { derived } from 'svelte/store';

  export let inst: EqualizerInstance;
  export let containerWidth: number;
  export let containerHeight: number;
  export let stageWidth: number;
  export let stageHeight: number;
  $: vcId = inst.vcId;
  $: instStateStore = inst.state;
  $: activeBandIx = $instStateStore.activeBandIx;
  $: activeBandFilterType =
    typeof activeBandIx === 'number' ? $instStateStore.bands[activeBandIx].filterType : null;
  $: lineSpectrogramStore = derived(inst.state, state => state.lineSpectrogramUIState);

  let xAxisContainer: SVGGElement;
  let yAxisContainer: SVGGElement;
  let gridContainer: SVGGElement;

  const drawAxesAndGrid = (stageWidth: number, innerHeight: number) => {
    if (stageWidth <= 0 || innerHeight <= 0) {
      return;
    }

    const xScale = d3.scaleLog().domain(EQ_X_DOMAIN).range([0, stageWidth]);
    const yScale = d3.scaleLinear().domain(EQ_GAIN_DOMAIN).range([innerHeight, 0]);

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

  $: y0Px = d3.scaleLinear().domain(EQ_GAIN_DOMAIN).range([stageHeight, 0])(0);

  const handleDoubleClick = (evt: MouseEvent) => {
    const rect = (evt.target as SVGElement).getBoundingClientRect();
    const x = evt.clientX - rect.left - EQ_AXIS_MARGIN.left;
    const y = evt.clientY - rect.top - EQ_AXIS_MARGIN.top;

    const xScale = d3.scaleLog().domain(EQ_X_DOMAIN).range([0, stageWidth]);
    const gainScale = d3.scaleLinear().domain(EQ_GAIN_DOMAIN).range([stageHeight, 0]);
    const qScale = d3.scaleLinear().domain(EQ_Q_DOMAIN).range([stageHeight, 0]);

    const filterType = activeBandFilterType ?? EqualizerFilterType.Peak;
    const axesParams = getEqAxes(filterType);
    const freq = xScale.invert(x);
    const gain = gainScale.invert(y);
    const q = qScale.invert(y);

    const newBand: EqualizerBand = {
      filterType,
      frequency: freq,
      gain: axesParams.yParam === 'gain' ? gain : 0,
      q: axesParams.yParam === 'q' ? q : 0,
    };

    inst.addBand(newBand);
  };
</script>

<div class="equalizer-bg" id="equalizer-bg-{vcId}">
  <div
    class="line-spectrogram-wrapper"
    style={`transform: translate(${EQ_AXIS_MARGIN.left}px, ${EQ_AXIS_MARGIN.top}px);`}
  >
    <LineSpectrogramUi
      inst={inst.lineSpectrogram}
      store={lineSpectrogramStore}
      forcedWidth={stageWidth}
      forcedHeight={stageHeight}
      enableAxes={false}
      containerMargins={{ top: 0, left: 0, right: 0, bottom: 0 }}
    />
  </div>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <svg
    class="eq-mag-response-plot"
    width={containerWidth}
    height={containerHeight}
    on:dblclick={handleDoubleClick}
  >
    <g
      transform={`translate(${EQ_AXIS_MARGIN.left},${EQ_AXIS_MARGIN.top})`}
      style="user-select: none; pointer-events: none;"
    >
      <g class="x-axis" bind:this={xAxisContainer} transform={`translate(0, ${stageHeight})`} />
      <g class="y-axis" bind:this={yAxisContainer} />
      <line x1={0} y1={y0Px} x2={stageWidth} y2={y0Px} class="y0-line" />
      <g class="grid" bind:this={gridContainer} />
    </g>
    <g
      transform={`translate(${EQ_AXIS_MARGIN.left},${EQ_AXIS_MARGIN.top})`}
      style="user-select: none; pointer-events: none;"
    >
      <path class="eq-mag-response-plot-path" />
    </g>
  </svg>
</div>

<style>
  .equalizer-bg {
    height: calc(100vh - 34px);
    width: 100%;
  }

  .line-spectrogram-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    user-select: none;
    pointer-events: none;
    z-index: -1;
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

  :global(.equalizer-bg line.y0-line) {
    stroke: #03d7fc;
    stroke-width: 1px;
    stroke-opacity: 0.7;
  }
</style>
