<script lang="ts">
  import type { LineSpectrogram } from 'src/visualizations/LineSpectrogram/LineSpectrogram';

  export let inst: LineSpectrogram;

  const dpr = Math.floor(window.devicePixelRatio || 1);
  let windowWidth = 100;
  $: width = (() => {
    const baseWidth = Math.floor(windowWidth * 0.75);
    const remainder = baseWidth % dpr;
    return baseWidth - remainder;
  })();
  const height = 400;
  $: inst.resizeView(width, height);

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
