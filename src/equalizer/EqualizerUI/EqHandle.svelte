<script lang="ts" context="module">
  const getParamControlledByAxis = (
    filterType: EqualizerFilterType,
    axis: 'x' | 'y'
  ): 'freq' | 'gain' | 'q' => {
    if (axis === 'x') {
      return 'freq';
    }

    switch (filterType) {
      case EqualizerFilterType.Peak:
      case EqualizerFilterType.Lowshelf:
      case EqualizerFilterType.Highshelf:
        return 'gain';
      case EqualizerFilterType.Highpass:
      case EqualizerFilterType.Lowpass:
      case EqualizerFilterType.Bandpass:
      case EqualizerFilterType.Notch:
      case EqualizerFilterType.Allpass:
        return 'q';
      default:
        filterType satisfies never;
        throw new Error(`Unknown filter type: ${filterType}`);
    }
  };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';

  import { EQ_X_DOMAIN, EQ_Y_DOMAIN } from 'src/equalizer/conf';
  import { EqualizerFilterType, type EqualizerBand } from 'src/equalizer/equalizer';
  import { clamp, NYQUIST } from 'src/util';
  import d3 from '../d3';

  export let band: EqualizerBand;
  export let bandIx: number;
  export let isActive: boolean;
  export let onClick: () => void;
  export let onChange: (band: EqualizerBand) => void;
  export let stageWidth: number;
  export let stageHeight: number;
  export let automationValsSAB: Float32Array | null;
  export let automatedParams: { freq: number | null; gain: number | null; q: number | null };
  export let eqUIHidden: boolean;

  $: xScale = d3.scaleLog().domain(EQ_X_DOMAIN).range([0, stageWidth]);
  // TODO: Need to handle both gain and q for y axis
  $: yScale = d3.scaleLinear().domain(EQ_Y_DOMAIN).range([stageHeight, 0]);

  $: canControlX = automatedParams[xParam] === null;
  $: canControlY = automatedParams[yParam] === null;

  $: computeHandlePos = (
    automatedParams: { freq: number | null; gain: number | null; q: number | null },
    xParam: 'freq' | 'gain' | 'q',
    yParam: 'freq' | 'gain' | 'q',
    band: EqualizerBand
  ): { x: number; y: number } => {
    const x = xScale(
      canControlX || !automationValsSAB
        ? band.frequency
        : clamp(10, NYQUIST, automationValsSAB[automatedParams[xParam]!])
    );
    const y = yScale(
      canControlY || !automationValsSAB
        ? band.gain
        : clamp(EQ_Y_DOMAIN[0], EQ_Y_DOMAIN[1], automationValsSAB[automatedParams[yParam]!])
    );
    return { x, y };
  };

  $: xParam = getParamControlledByAxis(band.filterType, 'x');
  $: yParam = getParamControlledByAxis(band.filterType, 'y');

  let position: { x: number; y: number } = { x: 0, y: 0 };
  $: position = computeHandlePos(automatedParams, xParam, yParam, band);

  let automationAnimationHandle: number | null = null;
  $: if (eqUIHidden || (canControlX && canControlY)) {
    if (automationAnimationHandle !== null) {
      cancelAnimationFrame(automationAnimationHandle);
      automationAnimationHandle = null;
    }
  } else {
    if (automationAnimationHandle === null) {
      automationAnimationHandle = requestAnimationFrame(() => {
        position = computeHandlePos(automatedParams, xParam, yParam, band);
        automationAnimationHandle = null;
      });
    }
  }

  onDestroy(() => {
    if (automationAnimationHandle !== null) {
      cancelAnimationFrame(automationAnimationHandle);
    }
  });

  $: updateBandFromPosition = (band: EqualizerBand, x: number, y: number) => {
    const newBand = { ...band };
    newBand.frequency = clamp(EQ_X_DOMAIN[0], EQ_X_DOMAIN[1], xScale.invert(x));
    if (yParam === 'gain') {
      newBand.gain = clamp(EQ_Y_DOMAIN[0], EQ_Y_DOMAIN[1], yScale.invert(y));
    } else {
      console.warn('unimplemented yParam:', yParam);
    }
    onChange(newBand);
  };

  let dragState: {
    startPosLocal: { x: number; y: number };
    lastPosScreen: { x: number; y: number };
    delta: { x: number; y: number };
  } | null = null;

  const handleDrag = (evt: MouseEvent) => {
    if (!dragState) {
      console.warn('Drag state should be set if this function is called');
      return;
    }

    const dx = evt.clientX - dragState.lastPosScreen.x;
    const dy = evt.clientY - dragState.lastPosScreen.y;
    dragState.delta = { x: dragState.delta.x + dx, y: dragState.delta.y + dy };
    dragState.lastPosScreen = { x: evt.clientX, y: evt.clientY };
    const newX = canControlX
      ? clamp(0, stageWidth, dragState.startPosLocal.x + dragState.delta.x)
      : dragState.startPosLocal.x;
    const newY = canControlY
      ? clamp(0, stageHeight, dragState.startPosLocal.y + dragState.delta.y)
      : dragState.startPosLocal.y;
    updateBandFromPosition(band, newX, newY);
  };

  const handleMouseDown = (evt: MouseEvent) => {
    evt.preventDefault();
    onClick();
    dragState = {
      startPosLocal: { x: position.x, y: position.y },
      lastPosScreen: { x: evt.clientX, y: evt.clientY },
      delta: { x: 0, y: 0 },
    };
    window.addEventListener('mousemove', handleDrag);
    window.addEventListener(
      'mouseup',
      () => {
        dragState = null;
        window.removeEventListener('mousemove', handleDrag);
      },
      { once: true }
    );
  };

  $: handleScroll = (evt: WheelEvent) => {
    evt.preventDefault();
    const deltaQ = evt.deltaY > 0 ? -0.1 : 0.1;
    const newQ = clamp(0.1, 30, band.q + deltaQ);
    onChange({ ...band, q: newQ });
  };
</script>

<div
  class="eq-handle"
  style={`transform: translate(${position.x - 14}px, ${position.y - 14}px);`}
  style:border={isActive ? '2px solid #45efff' : 'none'}
  on:mousedown={handleMouseDown}
  on:wheel={handleScroll}
  role="button"
  tabindex="0"
>
  {bandIx + 1}
</div>

<style lang="css">
  .eq-handle {
    position: absolute;
    width: 28px;
    height: 28px;
    background-color: #2059cc;
    border-radius: 50%;
    color: white;
    font-size: 12px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    user-select: none;
    box-sizing: border-box;
  }

  .eq-handle:hover {
    background-color: #0056b3;
  }

  .eq-handle:active {
    cursor: grabbing;
    background-color: #003f7f;
  }
</style>
