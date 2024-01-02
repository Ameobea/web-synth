<script lang="ts">
  import GatedIndicatorCircle from 'src/sampler/SamplerUI/GatedIndicatorCircle.svelte';
  import type { SamplerSelection } from 'src/sampler/sampler';

  export let activeSelectionIx: number | null;
  export let onClick: () => void;
  export let selection: SamplerSelection;
  export let selectionIx: number;
  export let isGated: boolean;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="generic-preset-picker-row"
  data-selected={`${activeSelectionIx === selectionIx}`}
  on:click={onClick}
>
  {#if selection.name}
    {selection.name}
  {:else}
    <span style="color: #888">&lt;</span>
    <span style="color: #aaa;">{selectionIx}</span>
    <span style="color: #888">&gt;</span>
  {/if}
  {#if isGated}
    <GatedIndicatorCircle />
  {/if}
</div>

<style lang="css">
  .generic-preset-picker-row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
</style>
