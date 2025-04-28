<script lang="ts">
  import { onDestroy } from 'svelte';

  import { EQ_X_DOMAIN, HANDLE_COLOR_BY_FILTER_TYPE } from 'src/equalizer/conf';
  import { type EqualizerBand } from 'src/equalizer/equalizer';
  import { clamp } from 'src/util';
  import d3 from '../d3';
  import { getEqAxes } from 'src/equalizer/eqHelpers';

  export let band: EqualizerBand;
  export let bandIx: number;
  export let isActive: boolean;
  export let setActive: () => void;
  export let onChange: (band: EqualizerBand) => void;
  export let stageWidth: number;
  export let stageHeight: number;
  export let automationValsSAB: Float32Array | null;
  export let automatedParams: { freq: number | null; gain: number | null; q: number | null };
  export let eqUIHidden: boolean;

  $: axesParams = getEqAxes(band.filterType);
  const xParam = 'freq' as const;
  $: yParam = axesParams.yParam;
  $: yDomain = axesParams.yDomain;
  $: scrollParam = axesParams.scrollParam;
  $: scrollDomain = axesParams.scrollDomain;

  $: xScale = d3.scaleLog().domain(EQ_X_DOMAIN).range([0, stageWidth]);
  $: yScale = d3.scaleLinear().domain(yDomain).range([stageHeight, 0]);

  $: canControlX = automatedParams[xParam] === null;
  $: canControlY = automatedParams[yParam] === null;

  $: computeHandlePos = (
    automatedParams: { freq: number | null; gain: number | null; q: number | null },
    yParam: 'gain' | 'q',
    band: EqualizerBand
  ): { x: number; y: number } => {
    const x = xScale(
      canControlX || !automationValsSAB
        ? band.frequency
        : clamp(EQ_X_DOMAIN[0], EQ_X_DOMAIN[1], automationValsSAB[automatedParams[xParam]!])
    );
    const y = yScale(
      canControlY || !automationValsSAB
        ? band[yParam]
        : clamp(yDomain[0], yDomain[1], automationValsSAB[automatedParams[yParam]!])
    );
    return { x: clamp(0, stageWidth, x), y: clamp(0, stageHeight, y) };
  };

  let position: { x: number; y: number } = { x: 0, y: 0 };
  $: position = computeHandlePos(automatedParams, yParam, band);

  let automationAnimationHandle: number | null = null;
  $: if (eqUIHidden || (canControlX && canControlY)) {
    if (automationAnimationHandle !== null) {
      cancelAnimationFrame(automationAnimationHandle);
      automationAnimationHandle = null;
    }
  } else {
    if (automationAnimationHandle === null) {
      automationAnimationHandle = requestAnimationFrame(() => {
        position = computeHandlePos(automatedParams, yParam, band);
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
    newBand[yParam] = clamp(yDomain[0], yDomain[1], yScale.invert(y));
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
    setActive();
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
    setActive();
    if (!scrollParam || !scrollDomain) {
      return;
    }

    evt.preventDefault();
    const scrollMag = clamp(0, 0.5, Math.abs(evt.deltaY) / 10);
    const deltaY = Math.sign(evt.deltaY) * -scrollMag;
    const newScrollParamVal = clamp(scrollDomain[0], scrollDomain[1], band[scrollParam] + deltaY);
    onChange({ ...band, [scrollParam]: newScrollParamVal });
  };
</script>

<div
  class="eq-handle"
  style={`transform: translate(${position.x - 14}px, ${position.y - 14}px);`}
  style:border={isActive ? '2px dashed #fff' : 'none'}
  style:background={HANDLE_COLOR_BY_FILTER_TYPE[band.filterType]}
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
