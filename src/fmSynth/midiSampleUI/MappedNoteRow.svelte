<script lang="ts">
  import type { MappedSampleData } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';

  import { getNoteColor, midiNumberToNoteName } from 'src/midiUtils';

  export let midiNumber: number;
  export let mappedSamples: MappedSampleData[] | undefined;
  let mappedSampleCount: number;
  $: {
    mappedSampleCount = mappedSamples?.length ?? 0;
  }
</script>

<div class="note-row" data-color={getNoteColor(midiNumber)} on:click>
  <div class="midi-number">{midiNumber}<br />{midiNumberToNoteName(midiNumber)}</div>
  <div class="content">
    {#if mappedSampleCount > 0}
      Mapped Count: {mappedSampleCount}
    {:else}
      <i class="no-mapped-samples">No Mapped Samples</i>
    {/if}
  </div>
</div>

<style lang="scss">
  .note-row {
    display: grid;
    grid-template-columns: 24px 1fr;
    font-size: 14px;
    padding: 2px 4px;
    cursor: pointer;
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

    .no-mapped-samples {
      color: #333;
    }
  }

  .note-row[data-color='white']:hover {
    background-color: rgb(226, 157, 226);
  }

  .note-row[data-color='black'] {
    background-color: #242424;
    color: #ddd;

    .no-mapped-samples {
      color: #9f9f9f;
    }
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
