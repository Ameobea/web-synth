<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Writable } from 'svelte/store';

  import type { LineSpectrogram } from 'src/visualizations/LineSpectrogram/LineSpectrogram';
  import type { LineSpectrumUIInst } from 'src/visualizations/LineSpectrogram/LineSpectrogramUIInst';
  import type { LineSpectrogramUIState } from 'src/visualizations/LineSpectrogram/types';

  let LineSpectrumUIInstComp:
    | typeof import('src/visualizations/LineSpectrogram/LineSpectrogramUIInst').LineSpectrumUIInst
    | null = null;
  onMount(() =>
    import('src/visualizations/LineSpectrogram/LineSpectrogramUIInst').then(module => {
      LineSpectrumUIInstComp = module.LineSpectrumUIInst;
    })
  );

  export let inst: LineSpectrogram;
  export let store: Writable<LineSpectrogramUIState>;

  const dpr = Math.floor(window.devicePixelRatio || 1);
  let windowWidth = 100;
  let windowHeight = 100;
  $: width = (() => {
    const baseWidth = Math.floor(windowWidth * 0.75);
    const remainder = baseWidth % dpr;
    return baseWidth - remainder;
  })();
  $: height = (() => {
    const baseHeight = Math.max(Math.floor(windowHeight - 122 - 82 - 340), 350);
    const remainder = baseHeight % dpr;
    return baseHeight - remainder;
  })();

  let container: HTMLDivElement | null = null;
  let uiInst: LineSpectrumUIInst | null = null;
  $: if (container && LineSpectrumUIInstComp) {
    uiInst?.destroy();
    uiInst = new LineSpectrumUIInstComp(
      container,
      { width, height },
      $store.rangeDb[0],
      $store.rangeDb[1]
    );
  }
  onDestroy(() => {
    uiInst?.destroy();
  });

  $: {
    inst.resizeView(width, height);
    uiInst?.updateSize({ width, height });
  }
  $: uiInst?.updateYRange($store.rangeDb[0], $store.rangeDb[1]);

  const useLineSpectrogram = (canvas: HTMLCanvasElement) => {
    const offscreenCanvas = canvas.transferControlToOffscreen();

    if (canvas) {
      inst.setCanvas(offscreenCanvas, dpr);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    const { x, y } = e;
    const { left, top } = container!.getBoundingClientRect();
    const canvasX = x - left;
    const canvasY = y - top;
    uiInst?.onMouseMove(canvasX, canvasY);
  };

  const handleMouseLeave = () => {
    uiInst?.onMouseOut();
  };
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />
<div bind:this={container} class="container">
  <canvas
    width={width * dpr}
    height={height * dpr}
    style="width: {width}px; height: {height}px;"
    use:useLineSpectrogram
    on:mousemove={handleMouseMove}
    on:mouseleave={handleMouseLeave}
  />
</div>

<style lang="css">
  .container {
    width: 100%;
    height: 100%;
    position: relative;
    margin-left: 30px;
    margin-top: 8px;
    margin-bottom: 16px;
  }
</style>
