<script lang="ts">
  import type { MappedSampleData } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
  import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
  import { genRandomStringID } from 'src/util';

  export let mappedSampleData: MappedSampleData;
  export let onDelete: () => void;

  const checkboxID = `loop-checkbox-${genRandomStringID()}`;
</script>

<div class="root">
  <div class="selected-sample">
    <b class="label">Selected Sample:</b>
    {#if mappedSampleData.descriptor}<span>{mappedSampleData.descriptor.name}</span>
    {:else}<i class="no-sample-mapped">No sample mapped</i>
    {/if}
  </div>
  <div class="buttons-container">
    <button
      class="select-sample-button"
      on:click={async () => {
        try {
          const selectedSample = await selectSample();
          mappedSampleData.descriptor = selectedSample;
          // TODO: Deal with load status??
        } catch (err) {
          // pass
        }
      }}
    >
      Pick Sample
    </button>
    <button style="margin-left: 8px;" on:click={onDelete}>Delete</button>
    <label class="loop-checkbox-label" for={checkboxID}>Loop</label>
    <input id={checkboxID} type="checkbox" bind:checked={mappedSampleData.doLoop} />
  </div>
</div>

<style lang="css">
  .root {
    margin-left: -2px;
    margin-right: -2px;
    margin-top: -2px;
    display: flex;
    flex-direction: column;
    padding: 8px;
    border: 1px solid #888;
  }

  .selected-sample {
    display: flex;
    flex-direction: row;
    margin-bottom: -1px;
  }

  .selected-sample .label {
    margin-right: 8px;
  }

  .no-sample-mapped {
    color: #999;
  }

  button {
    height: 26px;
  }

  .select-sample-button {
    width: 140px;
    margin-top: 8px;
  }

  .loop-checkbox-label {
    margin-left: 8px;
  }
</style>
