<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';
  import OscilloscopeControls from 'src/visualizations/Oscilloscope/OscilloscopeControls.svelte';
  import type { OscilloscopeUIState } from 'src/visualizations/Oscilloscope/types';

  export let inst: Oscilloscope;
  export let uiState: Writable<OscilloscopeUIState>;

  const dpr = Math.floor(window.devicePixelRatio || 1);
  let windowWidth = 100;
  $: width = (() => {
    const remainder = windowWidth % dpr;
    return windowWidth - remainder;
  })();
  $: height = (() => {
    const baseHeight = 340;
    const remainder = baseHeight % dpr;
    return baseHeight - remainder;
  })();
  $: inst.resizeView(width, height);

  const useOscilloscopeViz = (canvas: HTMLCanvasElement) => {
    const offscreenCanvas = canvas.transferControlToOffscreen();

    if (canvas) {
      inst.setView(offscreenCanvas, dpr);
    }
  };
</script>

<svelte:window bind:innerWidth={windowWidth} />
<div class="root">
  <canvas
    width={width * dpr}
    height={height * dpr}
    style="width: {width}px; height: {height}px;"
    use:useOscilloscopeViz
  />
  <OscilloscopeControls {inst} state={uiState} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
