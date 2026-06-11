<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { Readable } from 'svelte/store';

  import type { LineSpectrogram } from 'src/visualizations/LineSpectrogram/LineSpectrogram';
  import type { LineSpectrumUIInst } from 'src/visualizations/LineSpectrogram/LineSpectrogramUIInst';
  import type { LineSpectrogramUIState } from 'src/visualizations/LineSpectrogram/types';

  let LineSpectrumUIInstComp:
    | typeof import('src/visualizations/LineSpectrogram/LineSpectrogramUIInst').LineSpectrumUIInst
    | null = $state(null);
  onMount(() =>
    import('src/visualizations/LineSpectrogram/LineSpectrogramUIInst').then(module => {
      LineSpectrumUIInstComp = module.LineSpectrumUIInst;
    })
  );

  interface Props {
    inst: LineSpectrogram;
    store: Readable<LineSpectrogramUIState>;
    forcedWidth?: number | undefined;
    forcedHeight?: number | undefined;
    enableAxes?: boolean;
    containerMargins?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  }

  let {
    inst,
    store,
    forcedWidth = undefined,
    forcedHeight = undefined,
    enableAxes = true,
    containerMargins = { left: 30, right: 0, top: 8, bottom: 16 }
  }: Props = $props();

  const dpr = Math.floor(window.devicePixelRatio || 1);
  let windowWidth = $state(100);
  let windowHeight = $state(100);
  let width = $derived((() => {
    if (typeof forcedWidth === 'number') {
      return Math.floor(forcedWidth);
    }
    const baseWidth = Math.floor(windowWidth * 0.75);
    const remainder = baseWidth % dpr;
    return baseWidth - remainder;
  })());
  let height = $derived((() => {
    if (typeof forcedHeight === 'number') {
      return Math.floor(forcedHeight);
    }
    const baseHeight = Math.max(Math.floor(windowHeight - 122 - 82 - 340), 350);
    const remainder = baseHeight % dpr;
    return baseHeight - remainder;
  })());

  let container: HTMLDivElement | null = $state(null);
  let uiInst: LineSpectrumUIInst | null = $state(null);
  $effect(() => {
    if (container && LineSpectrumUIInstComp) {
      untrack(() => uiInst?.destroy());
      uiInst = new LineSpectrumUIInstComp(
        container,
        { width, height },
        $store.rangeDb[0],
        $store.rangeDb[1],
        enableAxes
      );
    }
  });
  onDestroy(() => {
    uiInst?.destroy();
  });

  let lastWidth = -1;
  let lastHeight = -1;
  $effect(() => {
    if (lastWidth !== width || lastHeight !== height) {
      inst.resizeView(width, height);
      uiInst?.updateSize({ width, height });
      lastWidth = width;
      lastHeight = height;
    }
  });
  $effect(() => {
    uiInst?.updateYRange($store.rangeDb[0], $store.rangeDb[1]);
  });

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
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
></canvas>
</div>

<style lang="css">
  .container {
    width: 100%;
    height: 100%;
    position: relative;
  }
</style>
