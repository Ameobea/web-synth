<script lang="ts">
  import * as R from 'ramda';

  import ConfigureMappedSample from 'src/fmSynth/midiSampleUI/ConfigureMappedSample.svelte';
  import {
    buildDefaultMappedSampleData,
    type MappedSampleData,
  } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';

  export let mappedSamples: MappedSampleData[] = [];
  export let onClose: () => void;
</script>

<div class="root">
  <div class="mapped-samples-container">
    {#each mappedSamples as mappedSampleData, i}
      <ConfigureMappedSample
        bind:mappedSampleData
        onDelete={() => {
          mappedSamples = R.remove(i, 1, mappedSamples);
        }}
      />
    {/each}
  </div>
  <button
    class="add-mapped-sample-button"
    on:click={() => (mappedSamples = [...mappedSamples, buildDefaultMappedSampleData()])}
  >
    Add Mapped Sample
  </button>
  <button class="close-button" on:click={onClose}>Collapse</button>
</div>

<style lang="css">
  .root {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 1px;
    min-height: 200px;
    border: 1px solid #888;
    background-color: #111;
  }

  .mapped-samples-container {
    display: flex;
    flex-direction: column;
  }

  button {
    height: 26px;
  }

  .add-mapped-sample-button {
    width: 200px;
    margin-bottom: 20px;
    margin-top: 10px;
  }

  .close-button {
    margin-top: auto;
  }
</style>
