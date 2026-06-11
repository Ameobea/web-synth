<script lang="ts">
  import GatedIndicatorCircle from 'src/sampler/SamplerUI/GatedIndicatorCircle.svelte';
  import type { SamplerSelection } from 'src/sampler/sampler';

  interface Props {
    activeSelectionIx: number | null;
    onClick: () => void;
    selection: SamplerSelection;
    selectionIx: number;
    isGated: boolean;
  }

  let {
    activeSelectionIx,
    onClick,
    selection,
    selectionIx,
    isGated
  }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="generic-preset-picker-row"
  data-selected={`${activeSelectionIx === selectionIx}`}
  onclick={onClick}
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
