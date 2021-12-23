<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { SampleMappingState } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
  import MappedSamplesListing from './MappedSamplesListing.svelte';

  export let store: Writable<SampleMappingState>;
</script>

<div class="root">
  <MappedSamplesListing
    bind:selectedMIDINumber={$store.selectedMIDINumber}
    bind:mappedSamplesByMIDINumber={$store.mappedSamplesByMIDINumber}
  />
</div>

<style lang="scss">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
