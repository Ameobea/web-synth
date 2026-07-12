<script lang="ts">
  import type { Readable } from 'svelte/store';

  import type { MIDIEditorInstance } from 'src/midiEditor';
  import { PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import type { ManagedMIDIEditorUIInstance } from 'src/midiEditor/MIDIEditorUIManager';
  import EditableInstanceName from './EditableInstanceName.svelte';
  import SvelteDragHandle from 'src/midiEditor/SvelteDragHandle.svelte';

  interface Props {
    parentInstance: MIDIEditorInstance;
    inst: ManagedMIDIEditorUIInstance;
    renderedMinimap: Readable<SVGSVGElement | undefined>;
    pxPerBeat: Readable<number>;
    scrollHorizontalBeats: Readable<number>;
    expand: () => void;
    instIx: number;
    activateDrag: () => void;
  }

  let {
    parentInstance,
    inst,
    renderedMinimap,
    pxPerBeat,
    scrollHorizontalBeats,
    expand,
    instIx,
    activateDrag
  }: Props = $props();

  let minimapContainer: HTMLDivElement | null = $state(null);
  let svg: SVGSVGElement | null = $state(null);

  let windowWidth = $state(100);

  // minimap SVG x positions are in beats, so we need to transform it so that it displays notes
  // scaled to match the zoom of the rest of the MIDI editor
  //
  // So, we want to display from [scrollHorizontalBeats, scrollHorizontalBeats + windowWidth / pxPerBeat]
  // in the SVG, but the SVG is 100vw wide, so we need to scale it by windowWidth / pxPerBeat.
  //
  // Y values are absolute, so we don't need to scale them.
  $effect(() => {
    if (svg) {
      svg.setAttribute('width', `${windowWidth - 40}px`);
      svg.setAttribute('height', '130px');
      const pianoKeyboardWidthBeats = PIANO_KEYBOARD_WIDTH / $pxPerBeat;
      svg.setAttribute(
        'viewBox',
        `${$scrollHorizontalBeats - pianoKeyboardWidthBeats} 0 ${(windowWidth - 40) / $pxPerBeat} 128`
      );
      svg.setAttribute('preserveAspectRatio', 'none');
    }
  });

  $effect(() => {
    if (minimapContainer && $renderedMinimap) {
      minimapContainer.appendChild($renderedMinimap);
      svg = $renderedMinimap;
    } else {
      svg = null;
    }
  });
</script>

<svelte:window bind:innerWidth={windowWidth} />
<div class="collapsed-midi-editor-instance">
  <button
    class="expand-midi-editor-instance"
    onclick={() => parentInstance.uiManager.expandUIInstance(inst.id)}
    style="top: -1px;"
  >
    ›
  </button>
  <SvelteDragHandle style={{ zIndex: 2, top: -1, left: 28, position: 'absolute' }} {activateDrag} />
  <button
    class="delete-cv-output-button"
    onclick={() => parentInstance.uiManager.deleteMIDIEditorInstance(inst.id)}
    style={instIx === 0 ? 'right: 30px' : undefined}
  >
    ✕
  </button>
  <EditableInstanceName
    left={60}
    name={inst.name}
    setName={newName => parentInstance.uiManager.renameInstance(inst.name, newName)}
    transparent
  />
  <div
    class="midi-editor-minimap-container"
    bind:this={minimapContainer}
    ondblclick={expand}
    role="figure"
></div>
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
    width: 27px;
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
