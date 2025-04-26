<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { EQ_AXIS_MARGIN } from 'src/equalizer/conf';
  import type { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
  import EqHandle from 'src/equalizer/EqualizerUI/EqHandle.svelte';
  import EqualizerBackground from 'src/equalizer/EqualizerUI/EqualizerBackground.svelte';

  export let inst: EqualizerInstance;
  $: stateStore = inst.state;
  $: state = $stateStore;

  let container: HTMLDivElement;
  let containerWidth: number = 0;
  let containerHeight: number = 0;

  $: stageWidth = containerWidth - EQ_AXIS_MARGIN.left - EQ_AXIS_MARGIN.right;
  $: stageHeight = containerHeight - EQ_AXIS_MARGIN.top - EQ_AXIS_MARGIN.bottom;

  let resizeObs: ResizeObserver;
  onMount(() => {
    resizeObs = new ResizeObserver(entries => {
      containerWidth = entries[0].contentRect.width;
      containerHeight = entries[0].contentRect.height;
      setTimeout(() => inst.maybeComputeAndPlotResponse());
    });
    resizeObs.observe(container);
  });

  onDestroy(() => resizeObs.disconnect());
</script>

<div class="root" bind:this={container}>
  <EqualizerBackground {inst} {containerWidth} {containerHeight} {stageWidth} {stageHeight} />
  <div class="handles" style={`top: ${EQ_AXIS_MARGIN.top}px; left: ${EQ_AXIS_MARGIN.left}px;`}>
    {#each state.bands as band, bandIx}
      <EqHandle
        {band}
        {bandIx}
        onChange={newBand => inst.setBand(bandIx, newBand)}
        {stageHeight}
        {stageWidth}
      />
    {/each}
  </div>
</div>

<style lang="css">
  .root {
    position: relative;
    display: flex;
    flex-direction: column;
    height: calc(100vh - 34px);
    width: calc(min(100%, 85vw));
    margin-left: auto;
    margin-right: auto;
    border: 1px solid #cccccc44;
  }

  .handles {
    position: absolute;
  }
</style>
