<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Readable } from 'svelte/store';

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
  export let store: Readable<LineSpectrogramUIState>;
  export let forcedWidth: number | undefined = undefined;
  export let forcedHeight: number | undefined = undefined;
  export let enableAxes: boolean = true;
  export let containerMargins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } = { left: 30, right: 0, top: 8, bottom: 16 };

  const dpr = Math.floor(window.devicePixelRatio || 1);
  let windowWidth = 100;
  let windowHeight = 100;
  $: width = (() => {
    if (typeof forcedWidth === 'number') {
      return Math.floor(forcedWidth);
    }
    const baseWidth = Math.floor(windowWidth * 0.75);
    const remainder = baseWidth % dpr;
    return baseWidth - remainder;
  })();
  $: height = (() => {
    if (typeof forcedHeight === 'number') {
      return Math.floor(forcedHeight);
    }
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
      $store.rangeDb[1],
      enableAxes
    );
  }
  onDestroy(() => {
    uiInst?.destroy();
  });

  let lastWidth = -1;
  let lastHeight = -1;
  $: if (lastWidth !== width || lastHeight !== height) {
    inst.resizeView(width, height);
    uiInst?.updateSize({ width, height });
    lastWidth = width;
    lastHeight = height;
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
<div
  bind:this={container}
  class="container"
  style={`margin-top: ${containerMargins.top}px; margin-left: ${containerMargins.left}px; margin-right: ${containerMargins.right}px; margin-bottom: ${containerMargins.bottom}px;`}
>
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
  }
</style>
