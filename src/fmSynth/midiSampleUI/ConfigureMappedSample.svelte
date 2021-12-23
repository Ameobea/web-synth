<script lang="ts">
  import type { MappedSampleData } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
  import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';

  export let mappedSampleData: MappedSampleData;
  export let onDelete: () => void;
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
  </div>
</div>

<style lang="scss">
  .root {
    margin-left: -2px;
    margin-right: -2px;
    display: flex;
    flex-direction: column;
    padding: 8px;
    border: 1px solid #888;
  }

  .selected-sample {
    display: flex;
    flex-direction: row;

    .label {
      margin-right: 8px;
    }
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
</style>
