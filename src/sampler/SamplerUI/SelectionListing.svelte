<script lang="ts">
  import type { SamplerSelection } from 'src/sampler/sampler';
  import '../../controls/GenericPresetPicker/GenericPresetPicker.css';
  import SelectionListingItem from 'src/sampler/SamplerUI/SelectionListingItem.svelte';
  import type { Writable } from 'svelte/store';

  interface Props {
    selections: SamplerSelection[];
    activeSelectionIx: number | null;
    setActiveSelectionIx: (ix: number | null) => void;
    getMidiGateStatusBufferF32: () => Float32Array | null;
    midiGateStatusUpdated: Writable<number>;
  }

  let {
    selections,
    activeSelectionIx,
    setActiveSelectionIx,
    getMidiGateStatusBufferF32,
    midiGateStatusUpdated
  }: Props = $props();

  // dummy dependency to force reactivity
  const getIsSelectionGated = (_midiGateStatusUpdated: number, sel: SamplerSelection): boolean =>
    typeof sel.midiNumber === 'number' && !!getMidiGateStatusBufferF32()?.[sel.midiNumber];

  let isGatedBySelectionIx = $derived(selections.map(sel => getIsSelectionGated($midiGateStatusUpdated, sel)));
</script>

<div class="root preset-list">
  <!-- <div class="generic-preset-picker-row" data-selected={`${false}`}>here we go</div> -->
  {#each selections as selection, selectionIx}
    <SelectionListingItem
      {selection}
      {selectionIx}
      {activeSelectionIx}
      onClick={() => setActiveSelectionIx(selectionIx)}
      isGated={isGatedBySelectionIx[selectionIx]}
    />
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
    margin-bottom: 0 !important;
    margin-top: 0 !important;
  }
</style>
