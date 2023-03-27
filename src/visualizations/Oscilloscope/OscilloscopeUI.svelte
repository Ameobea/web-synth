<script lang="ts">
  import type { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';

  export let inst: Oscilloscope;

  const useOscilloscopeViz = (canvas: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1;
    const offscreenCanvas = canvas.transferControlToOffscreen();

    if (canvas) {
      inst.setView(offscreenCanvas, dpr);
    }
  };
</script>

<div class="root">
  <canvas width={800} height={600} use:useOscilloscopeViz />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
