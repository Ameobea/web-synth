<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { GateUngateCallbackRegistrar } from 'src/fmSynth/midiSampleUI/types';
  import {
    buildDefaultSampleMappingOperatorState,
    type SampleMappingState,
  } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
  import MappedSamplesListing from './MappedSamplesListing.svelte';

  export let registerGateUngateCallbacks: GateUngateCallbackRegistrar;
  export let store: Writable<SampleMappingState>;
  export let operatorIx: number;

  $: if (!$store.stateByOperatorIx[operatorIx]) {
    $store.stateByOperatorIx[operatorIx] = buildDefaultSampleMappingOperatorState();
  }
</script>

<div class="root">
  <div
    class="mapped-samples-listing-header"
    on:click={() =>
      ($store.stateByOperatorIx[operatorIx].mappedSamplesListingExpanded =
        !$store.stateByOperatorIx[operatorIx].mappedSamplesListingExpanded)}
    on:keyup={() => {}}
    tabindex="0"
    role="button"
  >
    {$store.stateByOperatorIx[operatorIx].mappedSamplesListingExpanded ? '∨' : '›'} Mapped Samples
  </div>
  {#if $store.stateByOperatorIx[operatorIx] && $store.stateByOperatorIx[operatorIx].mappedSamplesListingExpanded}
    <MappedSamplesListing
      bind:selectedMIDINumber={$store.stateByOperatorIx[operatorIx].selectedMIDINumber}
      bind:state={$store.stateByOperatorIx[operatorIx]}
      {registerGateUngateCallbacks}
    />
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }

  .mapped-samples-listing-header {
    background-color: #1b1b1b;
    border: 1px solid #555;
    display: flex;
    align-items: center;
    padding-left: 6px;
    max-height: 25px;
    font-size: 17px;
    color: #b6b6b6;
    box-sizing: border-box;
    user-select: none;
    cursor: pointer;
    background-color: #2c2c2c;
  }
</style>
