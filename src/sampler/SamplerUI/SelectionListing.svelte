<script lang="ts">
  import type { SamplerSelection } from 'src/sampler/sampler';
  import '../../controls/GenericPresetPicker/GenericPresetPicker.scss';

  export let selections: SamplerSelection[];
  export let activeSelectionIx: number | null;
  export let setActiveSelectionIx: (ix: number | null) => void;
</script>

<div class="root preset-list">
  <!-- <div class="generic-preset-picker-row" data-selected={`${false}`}>here we go</div> -->
  {#each selections as selection, i}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="generic-preset-picker-row"
      data-selected={`${activeSelectionIx === i}`}
      on:click={() => setActiveSelectionIx(i)}
    >
      {#if selection.name}
        {selection.name}
      {:else}
        <span style="color: #888">&lt;</span>
        <span style="color: #aaa;">{i}</span>
        <span style="color: #888">&gt;</span>
      {/if}
    </div>
  {/each}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    max-width: 298px;
    min-width: 298px;
    height: 350px;
    overflow-y: auto;
  }
</style>
