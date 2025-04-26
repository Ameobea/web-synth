<script lang="ts">
  import { EQ_X_DOMAIN, EQ_Y_DOMAIN } from 'src/equalizer/conf';
  import { type EqualizerBand } from 'src/equalizer/equalizer';
  import { clamp } from 'src/util';
  import d3 from '../d3';

  export let band: EqualizerBand;
  export let bandIx: number;
  export let onChange: (band: EqualizerBand) => void;
  export let stageWidth: number;
  export let stageHeight: number;

  $: xScale = d3.scaleLog().domain(EQ_X_DOMAIN).range([0, stageWidth]);
  $: yScale = d3.scaleLinear().domain(EQ_Y_DOMAIN).range([stageHeight, 0]);

  $: computeHandlePos = (band: EqualizerBand): { x: number; y: number } => {
    const x = xScale(band.frequency);
    const y = yScale(band.gain);
    return { x, y };
  };

  $: position = computeHandlePos(band);

  $: updateBandFromPosition = (band: EqualizerBand, x: number, y: number) => {
    const frequency = clamp(EQ_X_DOMAIN[0], EQ_X_DOMAIN[1], xScale.invert(x));
    const gain = clamp(EQ_Y_DOMAIN[0], EQ_Y_DOMAIN[1], yScale.invert(y));
    onChange({ ...band, frequency, gain });
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
    const newX = clamp(0, stageWidth, dragState.startPosLocal.x + dragState.delta.x);
    const newY = clamp(0, stageHeight, dragState.startPosLocal.y + dragState.delta.y);
    updateBandFromPosition(band, newX, newY);
  };

  const handleMouseDown = (evt: MouseEvent) => {
    evt.preventDefault();
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
  style={`transform: translate(${position.x}px, ${position.y}px);`}
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
    width: 20px;
    height: 20px;
    background-color: #007bff;
    border-radius: 50%;
    color: white;
    font-size: 12px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    user-select: none;
  }

  .eq-handle:hover {
    background-color: #0056b3;
  }

  .eq-handle:active {
    cursor: grabbing;
    background-color: #003f7f;
  }
</style>
