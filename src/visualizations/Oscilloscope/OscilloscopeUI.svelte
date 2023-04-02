<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';
  import OscilloscopeControls from 'src/visualizations/Oscilloscope/OscilloscopeControls.svelte';
  import type { OscilloscopeUIState } from 'src/visualizations/Oscilloscope/types';

  export let inst: Oscilloscope;
  export let uiState: Writable<OscilloscopeUIState>;

  // TODO: Dynamically sized
  const width = 1500;
  const height = 600;

  const dpr = Math.floor(window.devicePixelRatio || 1);
  const useOscilloscopeViz = (canvas: HTMLCanvasElement) => {
    const offscreenCanvas = canvas.transferControlToOffscreen();

    if (canvas) {
      inst.setView(offscreenCanvas, dpr);
    }
  };
</script>

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
