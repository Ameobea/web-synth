<script lang="ts">
  import { onMount } from 'svelte';

  const CANVAS_WIDTH = 400;
  const CANVAS_HEIGHT = 50;

  interface Props {
    phaseSAB: Float32Array;
  }

  let { phaseSAB }: Props = $props();

  let canvas: HTMLCanvasElement | null = $state(null);
  let ctx: CanvasRenderingContext2D | null = $derived.by(() =>
    canvas ? canvas.getContext('2d') : null
  );

  let animationFrameHandle: number | null = null;
  onMount(() => {
    const cb = () => {
      if (!ctx) {
        animationFrameHandle = requestAnimationFrame(cb);
        return;
      }

      const curPhase = phaseSAB[0];
      console.log({ curPhase, phaseSAB });

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const linePosX = curPhase * CANVAS_WIDTH;
      ctx.beginPath();
      ctx.moveTo(linePosX, 0);
      ctx.lineTo(linePosX, CANVAS_HEIGHT);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.closePath();

      animationFrameHandle = requestAnimationFrame(cb);
    };
    animationFrameHandle = requestAnimationFrame(cb);

    return () => {
      if (typeof animationFrameHandle === 'number') {
        cancelAnimationFrame(animationFrameHandle);
      }
    };
  });
</script>

<div class="root">
  <canvas
    width={CANVAS_WIDTH}
    height={CANVAS_HEIGHT}
    style={`width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px;`}
    bind:this={canvas}
></canvas>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 8px;
  }

  canvas {
    background-color: #000;
  }
</style>
