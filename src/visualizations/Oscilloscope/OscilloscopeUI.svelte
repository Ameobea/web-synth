<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';
  import OscilloscopeControls from 'src/visualizations/Oscilloscope/OscilloscopeControls.svelte';
  import type { OscilloscopeUIState } from 'src/visualizations/Oscilloscope/types';

  interface Props {
    inst: Oscilloscope;
    uiState: Writable<OscilloscopeUIState>;
  }

  let { inst, uiState }: Props = $props();

  const dpr = Math.floor(window.devicePixelRatio || 1);
  let windowWidth = $state(100);
  let width = $derived((() => {
    const remainder = windowWidth % dpr;
    return windowWidth - remainder;
  })());
  let height = $derived((() => {
    const baseHeight = 340;
    const remainder = baseHeight % dpr;
    return baseHeight - remainder;
  })());
  $effect(() => {
    inst.resizeView(width, height);
  });

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
></canvas>
  <OscilloscopeControls {inst} state={uiState} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
