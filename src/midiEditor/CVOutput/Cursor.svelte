<script lang="ts">
  import type { MIDIEditorBaseView } from 'src/midiEditor';
  import { CURSOR_COLOR } from 'src/midiEditor/conf';
  import { colorToHexString } from 'src/util';
  import { onMount } from 'svelte';

  export let marginLeft: number;
  export let marginTop: number;
  export let width: number;
  export let height: number;
  export let view: MIDIEditorBaseView;
  export let getCursorPosBeats: () => number;
  export let setCursorPosBeats: (pos: number) => void;

  $: pxPerBeat = view.pxPerBeat;
  $: scrollHorizontalBeats = view.scrollHorizontalBeats;

  let cursorPosBeats = getCursorPosBeats();

  $: left = (cursorPosBeats - scrollHorizontalBeats) * pxPerBeat;

  let pointerDown = false;

  const pxToBeats = (px: number) => (px - marginLeft) / pxPerBeat;

  const handleMouseMove = (evt: MouseEvent) => {
    if (!pointerDown) {
      return;
    }

    const newCursorPosBeats = scrollHorizontalBeats + pxToBeats(evt.clientX);
    setCursorPosBeats(newCursorPosBeats);
  };

  const handleCursorClick = (evt: MouseEvent) => {
    pointerDown = true;
  };

  const handleMouseUp = (evt: MouseEvent) => {
    pointerDown = false;
  };

  onMount(() => {
    let handle = 0;

    const cb = () => {
      const newCursorPosBeats = getCursorPosBeats();
      if (newCursorPosBeats !== cursorPosBeats) {
        cursorPosBeats = newCursorPosBeats;
      }

      handle = requestAnimationFrame(cb);
    };
    handle = requestAnimationFrame(cb);

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      if (handle) {
        cancelAnimationFrame(handle);
      }

      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  });
</script>

<svg
  class="root"
  viewBox={`0 0 ${width} {height}`}
  xmlns="http://www.w3.org/2000/svg"
  style="width: {width}px; height: {height}px; left: {marginLeft}px; top: {marginTop}px;"
>
  <g transform={`translate(${left - 0.1}, 0)`} style="pointer-events: all;">
    <line
      x1="0"
      x2="0"
      y1="0"
      y2="100%"
      stroke={colorToHexString(CURSOR_COLOR)}
      stroke-width="0.5"
      cursor="pointer"
    />
    <!-- transparent background a little wider so the user can click/drag it -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <rect
      x="-5"
      y="0"
      width="10"
      height="100%"
      fill="transparent"
      cursor="pointer"
      on:pointerdown={handleCursorClick}
    />
  </g>
</svg>

<style lang="css">
  .root {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
