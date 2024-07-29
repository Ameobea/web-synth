<script context="module">
  const WHITE_NOTES = [
    { name: 'C', index: 0 },
    { name: 'D', index: 2 },
    { name: 'E', index: 4 },
    { name: 'F', index: 5 },
    { name: 'G', index: 7 },
    { name: 'A', index: 9 },
    { name: 'B', index: 11 },
  ];
  const BLACK_NOTES = [
    { name: 'C♯', index: 1 },
    { name: 'E♭', index: 3 },
    null,
    { name: 'F♯', index: 6 },
    { name: 'A♭', index: 8 },
    { name: 'B♭', index: 10 },
  ];
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { MIDIQuantizerNodeUIState } from 'src/graphEditor/nodes/CustomAudio/MIDIQuantizer/types';
  import Note from './Note.svelte';
  import { getIsGlobalBeatCounterStarted } from 'src/eventScheduler';

  export let store: Writable<MIDIQuantizerNodeUIState>;

  const mkHandleNoteToggle = (index: number) => () =>
    ($store.activeNotes[index] = !$store.activeNotes[index]);
</script>

<div class="midi-quantizer-node-ui">
  <p class="info">
    This node takes control signals in the range of [-1, 1] and quantizes them into MIDI output. A
    new MIDI note is emitted every time the input changes with a configurable threshold for minimum
    duration between notes.
  </p>
  <div style="display: flex; flex-direction: row; align-items: center;">
    <div style="margin-right: 16px;">
      Obey Global Start/Stop
      <input
        type="checkbox"
        checked={$store.startOnGlobalStart}
        on:change={evt => {
          const newStartOnGlobalStart = !$store.startOnGlobalStart;
          $store.startOnGlobalStart = newStartOnGlobalStart;
          if (newStartOnGlobalStart) {
            const globalBeatCountStarted = getIsGlobalBeatCounterStarted();
            $store.isRunning = globalBeatCountStarted;
          } else {
            $store.isRunning = false;
          }
        }}
      />
    </div>
    {#if !$store.startOnGlobalStart}
      <button class="start-stop-button" on:click={() => ($store.isRunning = !$store.isRunning)}>
        {$store.isRunning ? 'Stop' : 'Start'}
      </button>
    {/if}
  </div>
  <h3>Octave Range</h3>
  <div class="octave-range">
    <div class="octave-button-group">
      <button
        class="change-octave-range-button"
        disabled={$store.octaveRange[0] >= $store.octaveRange[1]}
        on:click={() => ($store.octaveRange[0] += 1)}
      >
        +
      </button>
      <button
        class="change-octave-range-button"
        disabled={$store.octaveRange[0] <= -2}
        on:click={() => ($store.octaveRange[0] -= 1)}
      >
        -
      </button>
    </div>
    <div class="octave-range-display">{$store.octaveRange[0]} - {$store.octaveRange[1]}</div>
    <div class="octave-button-group">
      <button
        class="change-octave-range-button"
        disabled={$store.octaveRange[1] >= 6}
        on:click={() => ($store.octaveRange[1] += 1)}
      >
        +
      </button>
      <button
        class="change-octave-range-button"
        disabled={$store.octaveRange[1] <= $store.octaveRange[0]}
        on:click={() => ($store.octaveRange[1] -= 1)}
      >
        -
      </button>
    </div>
  </div>

  <div class="active-note-select">
    <h3>Active Notes</h3>
    <div class="note-row" style="padding-left: 20px">
      {#each BLACK_NOTES as note}
        {#if note}
          <Note
            selected={$store.activeNotes[note.index]}
            noteType="black"
            onClick={mkHandleNoteToggle(note.index)}>{note.name}</Note
          >
        {:else}
          <div class="note-spacer" />
        {/if}
      {/each}
    </div>
    <div class="note-row">
      {#each WHITE_NOTES as note}
        <Note
          selected={$store.activeNotes[note.index]}
          noteType="white"
          onClick={mkHandleNoteToggle(note.index)}>{note.name}</Note
        >
      {/each}
    </div>
  </div>
</div>

<style lang="css">
  .midi-quantizer-node-ui {
    width: 500px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0px 8px;
  }

  .midi-quantizer-node-ui h3 {
    margin-top: 8px;
    margin-bottom: 4px;
  }

  .octave-range {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .octave-range-display {
    font-size: 24px;
    font-family: 'Hack', 'Input Mono', 'Input', 'Oxygen Mono', monospace;
    padding-left: 4px;
    padding-right: 4px;
  }

  .octave-button-group {
    display: flex;
    flex-direction: column;
  }

  .active-note-select {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .active-note-select .note-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    flex: 1;
    width: 100%;
    margin-bottom: 4px;
    box-sizing: border-box;
  }

  .active-note-selecg .note-row .note-spacer {
    width: 30px;
    height: 30px;
  }
</style>
