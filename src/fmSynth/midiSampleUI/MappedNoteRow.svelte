<script lang="ts">
  import type { MappedSampleData } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
  import { getNoteColor, midiNumberToNoteName } from 'src/midiUtils';

  export let midiNumber: number;
  export let mappedSamples: MappedSampleData[] | undefined;
  export let isGated: boolean;
  let mappedSampleCount: number;
  $: mappedSampleCount = mappedSamples?.filter(d => !!d.descriptor).length ?? 0;
</script>

<div
  class="note-row"
  data-color={getNoteColor(midiNumber)}
  data-gated={`${isGated}`}
  on:click
  on:keyup={() => {}}
  tabindex="0"
  role="button"
>
  <div class="midi-number">{midiNumber}<br />{midiNumberToNoteName(midiNumber)}</div>
  <div class="content">
    {#if mappedSampleCount > 0}
      Mapped Count: {mappedSampleCount}
    {:else}
      <i class="no-mapped-samples">No Mapped Samples</i>
    {/if}
  </div>
</div>

<style lang="css">
  .note-row {
    display: grid;
    grid-template-columns: 24px 1fr;
    font-size: 14px;
    padding: 2px 4px;
    cursor: pointer;
  }

  .note-row[data-gated='true'] {
    background-color: rgb(250, 82, 250) !important;
    color: #121212 !important;
  }

  .note-row[data-gated='true'] .no-mapped-samples {
    color: #222 !important;
  }

  .midi-number {
    font-family: Hack, 'Input Mono', Menlo, Monaco, Consolas, 'Courier New', monospace;
    font-size: 12px;
    letter-spacing: -1px;
    display: flex;
    justify-content: center;
    text-align: center;
    margin-right: 4px;
  }

  .note-row[data-color='white'] {
    background-color: #ddd;
    color: #121212;
  }

  .note-row[data-color='white'] .no-mapped-samples {
    color: #333;
  }

  .note-row[data-color='white']:hover {
    background-color: rgb(226, 157, 226);
  }

  .note-row[data-color='black'] {
    background-color: #242424;
    color: #ddd;
  }

  .note-row[data-color='black'] .no-mapped-samples {
    color: #9f9f9f;
  }

  .note-row[data-color='black']:hover {
    background-color: rgb(66, 38, 66);
  }

  .content {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding-left: 6px;
  }
</style>
