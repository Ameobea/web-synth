<script lang="ts">
  import type { LineSpectrogram } from 'src/visualizations/LineSpectrogram/LineSpectrogram';

  export let inst: LineSpectrogram;

  let windowWidth = 100;
  $: width = Math.floor(windowWidth * 0.8);
  const height = 400;
  $: inst.resizeView(width, height);

  const dpr = Math.floor(window.devicePixelRatio || 1);
  const useLineSpectrogram = (canvas: HTMLCanvasElement) => {
    const offscreenCanvas = canvas.transferControlToOffscreen();

    if (canvas) {
      inst.setCanvas(offscreenCanvas, dpr);
    }
  };
</script>

<svelte:window bind:innerWidth={windowWidth} />
<canvas
  width={width * dpr}
  height={height * dpr}
  style="width: {width}px; height: {height}px;"
  use:useLineSpectrogram
/>
