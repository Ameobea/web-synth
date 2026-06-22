<script lang="ts">
  import type { Readable } from 'svelte/store';

  import type { MIDIEditorInstance } from 'src/midiEditor';
  import { CURSOR_COLOR, PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import {
    addOrUpdateTempoChange,
    getBpmAtBeat,
    removeTempoChange,
    tempoChangesStore,
  } from 'src/globalMenu/globalTempo';
  import ConfigureTempoFlag from './ConfigureTempoFlag.svelte';

  interface Props {
    parentInstance: MIDIEditorInstance;
    pxPerBeat: Readable<number>;
    scrollHorizontalBeats: Readable<number>;
  }

  let { parentInstance, pxPerBeat, scrollHorizontalBeats }: Props = $props();

  const TRACK_HEIGHT = 28;
  const cursorColor = `#${CURSOR_COLOR.toString(16).padStart(6, '0')}`;

  let windowWidth = $state(1000);
  let svgEl: SVGSVGElement | null = $state(null);

  let config: {
    beat: number;
    bpm: number;
    isBase: boolean;
    top: number;
    left: number;
  } | null = $state(null);

  const xOf = (beat: number): number =>
    PIANO_KEYBOARD_WIDTH + (beat - $scrollHorizontalBeats) * $pxPerBeat;

  const formatBpm = (bpm: number): string => {
    const rounded = Math.round(bpm * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
  };

  let flags = $derived(
    $tempoChangesStore.map(change => {
      const label = formatBpm(change.bpm);
      return {
        beat: change.beat,
        bpm: change.bpm,
        isBase: change.beat === 0,
        x: xOf(change.beat),
        label,
        tabWidth: 9 + label.length * 6.5,
      };
    })
  );

  const beatFromClientX = (clientX: number): number => {
    const rect = svgEl!.getBoundingClientRect();
    const localX = clientX - rect.left;
    return $scrollHorizontalBeats + (localX - PIANO_KEYBOARD_WIDTH) / $pxPerBeat;
  };

  const handleBackgroundDblClick = (evt: MouseEvent) => {
    if (!svgEl) {
      return;
    }
    const rect = svgEl.getBoundingClientRect();
    if (evt.clientX - rect.left < PIANO_KEYBOARD_WIDTH) {
      return;
    }
    const beat = parentInstance.snapBeat(beatFromClientX(evt.clientX));
    if (beat <= 0) {
      return;
    }
    addOrUpdateTempoChange(beat, getBpmAtBeat(beat));
  };

  const openConfig = (evt: MouseEvent, beat: number, bpm: number) => {
    evt.stopPropagation();
    config = { beat, bpm, isBase: beat === 0, top: evt.clientY, left: evt.clientX };
  };

  const handleFlagContextMenu = (evt: MouseEvent, beat: number) => {
    evt.preventDefault();
    evt.stopPropagation();
    if (beat !== 0) {
      removeTempoChange(beat);
    }
  };

  const submitConfig = (newBeat: number, newBpm: number) => {
    if (!config) {
      return;
    }
    if (!config.isBase && newBeat !== config.beat) {
      removeTempoChange(config.beat);
    }
    addOrUpdateTempoChange(config.isBase ? 0 : newBeat, newBpm);
    config = null;
  };
</script>

<svelte:window bind:innerWidth={windowWidth} />

<div class="tempo-track">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg
    bind:this={svgEl}
    width={windowWidth}
    height={TRACK_HEIGHT}
    ondblclick={handleBackgroundDblClick}
    oncontextmenu={e => e.preventDefault()}
  >
    <text x={6} y={18} class="gutter-label">Tempo</text>
    <line
      x1={PIANO_KEYBOARD_WIDTH}
      y1={0}
      x2={PIANO_KEYBOARD_WIDTH}
      y2={TRACK_HEIGHT}
      stroke="#444"
      stroke-width={1}
    />
    {#each flags as flag (flag.beat)}
      {#if flag.x > PIANO_KEYBOARD_WIDTH - flag.tabWidth && flag.x < windowWidth}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g
          class="tempo-flag"
          ondblclick={e => openConfig(e, flag.beat, flag.bpm)}
          oncontextmenu={e => handleFlagContextMenu(e, flag.beat)}
        >
          <line
            x1={flag.x}
            y1={0}
            x2={flag.x}
            y2={TRACK_HEIGHT}
            stroke={cursorColor}
            stroke-width={1}
            stroke-opacity={0.6}
          />
          <rect
            x={flag.x}
            y={2}
            width={flag.tabWidth}
            height={14}
            fill={flag.isBase ? '#243b2a' : '#2a2a2a'}
            stroke={cursorColor}
            stroke-opacity={0.5}
            rx={1}
          />
          <text x={flag.x + 4} y={13} class="flag-label">{flag.label}</text>
        </g>
      {/if}
    {/each}
  </svg>
</div>

{#if config}
  <ConfigureTempoFlag
    top={config.top}
    left={config.left}
    initialBeat={config.beat}
    initialBpm={config.bpm}
    isBase={config.isBase}
    onCancel={() => (config = null)}
    onSubmit={submitConfig}
    onDelete={config.isBase ? null : () => {
      removeTempoChange(config!.beat);
      config = null;
    }}
  />
{/if}

<style lang="css">
  .tempo-track {
    width: 100%;
    height: 28px;
    background-color: #0c0c0c;
    border-bottom: 1px solid #333;
    overflow: hidden;
    user-select: none;
  }

  .gutter-label {
    fill: #888;
    font-size: 11px;
    font-family: 'Hack', 'Oxygen Mono', monospace;
  }

  .flag-label {
    fill: #dcdcdc;
    font-size: 10px;
    font-family: 'Hack', 'Oxygen Mono', monospace;
    pointer-events: none;
  }

  .tempo-flag {
    cursor: pointer;
  }
</style>
