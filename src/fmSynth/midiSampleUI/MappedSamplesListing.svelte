<script lang="ts" context="module">
  const MIDI_NOTE_RANGE = new Array(99).fill(null).map((_, i) => i);
</script>

<script lang="ts">
  import ConfigureMidiMapping from 'src/fmSynth/midiSampleUI/ConfigureMIDIMapping.svelte';

  import MappedNoteRow from 'src/fmSynth/midiSampleUI/MappedNoteRow.svelte';
  import type { MappedSampleData } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';

  export let mappedSamplesByMIDINumber: { [midiNumber: number]: MappedSampleData[] };
  export let selectedMIDINumber: number | null;
</script>

<div class="root">
  {#each MIDI_NOTE_RANGE as midiNumber}
    <MappedNoteRow
      {midiNumber}
      mappedSamples={mappedSamplesByMIDINumber[midiNumber]}
      on:click={evt => {
        selectedMIDINumber = midiNumber === selectedMIDINumber ? null : midiNumber;
      }}
    />
    {#if selectedMIDINumber === midiNumber}
      <ConfigureMidiMapping
        onClose={() => {
          selectedMIDINumber = null;
        }}
        bind:mappedSamples={mappedSamplesByMIDINumber[midiNumber]}
      />
    {/if}
  {/each}
</div>

<style lang="scss">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
