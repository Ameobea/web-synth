<script lang="ts">
  import type { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';

  export let inst: Oscilloscope;

  // TODO: Dynamically sized
  const width = 2400;
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
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
