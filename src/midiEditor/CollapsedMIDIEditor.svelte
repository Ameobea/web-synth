<script lang="ts">
  import type { Readable } from 'svelte/store';

  import type { MIDIEditorInstance } from 'src/midiEditor';
  import { PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import type { ManagedMIDIEditorUIInstance } from 'src/midiEditor/MIDIEditorUIManager';
  import EditableInstanceName from './EditableInstanceName.svelte';

  export let parentInstance: MIDIEditorInstance;
  export let inst: ManagedMIDIEditorUIInstance;
  export let pxPerBeat: Readable<number>;
  export let scrollHorizontalBeats: Readable<number>;
  export let expand: () => void;
  export let instIx: number;

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
  <button
    class="delete-cv-output-button"
    on:click={() => parentInstance.uiManager.deleteMIDIEditorInstance(inst.id)}
    style={instIx === 0 ? 'right: 30px' : undefined}
  >
    ✕
  </button>
  <EditableInstanceName
    left={PIANO_KEYBOARD_WIDTH + 2}
    name={inst.name}
    setName={newName => parentInstance.uiManager.renameInstance(inst.name, newName)}
  />
  <div
    class="midi-editor-minimap-container"
    bind:this={minimapContainer}
    on:dblclick={expand}
    role="figure"
  />
</div>

<style lang="css">
  .collapsed-midi-editor-instance {
    position: relative;
    height: 130px;
    background-color: black;
    box-sizing: border-box;
    border-top: 1px solid #555;
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
