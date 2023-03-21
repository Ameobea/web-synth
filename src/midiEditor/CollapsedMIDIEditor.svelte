<script lang="ts">
  import { Readable } from 'svelte/store';

  import type { MIDIEditorInstance } from 'src/midiEditor';
  import { PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import type { ManagedMIDIEditorUIInstance } from 'src/midiEditor/MIDIEditorUIManager';

  export let parentInstance: MIDIEditorInstance;
  export let inst: ManagedMIDIEditorUIInstance;
  export let pxPerBeat: Readable<number>;
  export let scrollHorizontalBeats: Readable<number>;
  export let expand: () => void;

  let minimapContainer: HTMLDivElement | null = null;
  let svg: SVGSVGElement | null = null;

  let windowWidth = 100;

  // minimap SVG x positions are in beats, so we need to transform it so that it displays notes
  // scaled to match the zoom of the rest of the MIDI editor
  //
  // So, we want to display from [scrollHorizontalBeats, scrollHorizontalBeats + windowWidth / pxPerBeat]
  // in the SVG, but the SVG is 100vw wide, so we need to scale it by windowWidth / pxPerBeat.
  //
  // Y values are absolute, so we don't need to scale them.
  $: if (svg) {
    svg.setAttribute('width', `${windowWidth - 40}px`);
    svg.setAttribute('height', '130px');
    const pianoKeyboardWidthBeats = PIANO_KEYBOARD_WIDTH / $pxPerBeat;
    svg.setAttribute(
      'viewBox',
      `${$scrollHorizontalBeats - pianoKeyboardWidthBeats} 0 ${(windowWidth - 40) / $pxPerBeat} 128`
    );
    svg.setAttribute('preserveAspectRatio', 'none');
  }

  $: {
    if (minimapContainer && inst.renderedMinimap) {
      minimapContainer.appendChild(inst.renderedMinimap);
      svg = inst.renderedMinimap;
    } else {
      svg = null;
    }
  }
</script>

<svelte:window bind:innerWidth={windowWidth} />
<div class="collapsed-midi-editor-instance">
  <button
    class="expand-midi-editor-instance"
    on:click={() => parentInstance.uiManager.expandUIInstance(inst.id)}
  >
    ›
  </button>
  <div class="midi-editor-instance-name" style="left: {PIANO_KEYBOARD_WIDTH}px">{inst.name}</div>
  <div class="midi-editor-minimap-container" bind:this={minimapContainer} on:dblclick={expand} />
</div>

<style lang="css">
  .collapsed-midi-editor-instance {
    position: relative;
    height: 130px;
    background-color: black;
    box-sizing: border-box;
    border-top: 1px solid #555;
  }

  .midi-editor-instance-name {
    position: absolute;
    top: 2px;
    font-size: 13px;
    font-family: Hack, Oxygen Mono, Menlo, monospace;
    z-index: 2;
    user-select: none;
    background-color: #000000c9;
    padding-left: 4px;
    padding-right: 4px;
  }

  .expand-midi-editor-instance {
    z-index: 2;
  }

  .midi-editor-minimap-container {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(100vw - 40px);
    height: 130px;
    background-color: black;
  }
</style>
