<script lang="ts">
  import type { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
  import { onDestroy, onMount } from 'svelte';

  export let inst: EqualizerInstance;
  $: vcId = inst.vcId;

  let container: HTMLDivElement;
  let containerWidth: number = 1000;
  let containerHeight: number = 500;

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

<div class="equalizer-bg" id="equalizer-bg-{vcId}" bind:this={container}>
  <svg class="eq-mag-response-plot" width={containerWidth} height={containerHeight}>
    <path class="eq-mag-response-plot-path" />
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
</style>
