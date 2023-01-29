<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { CVOutputUIState } from 'src/midiEditor/CVOutput/CVOutput';
  import CollapsedCvOutputControls from './CollapsedCVOutputControls.svelte';
  import CVOutputControlsInner from './CVOutputControlsInner.svelte';

  export let name: string;
  export let state: Writable<CVOutputUIState>;
  export let deleteOutput: () => void;

  const expand = () => {
    $state.isExpanded = true;
  };
  const collapse = () => {
    $state.isExpanded = false;
  };
</script>

{#if !$state.isExpanded}
  <CollapsedCvOutputControls {name} {expand} {deleteOutput} />
{:else}
  <CVOutputControlsInner {name} {state} {collapse} {deleteOutput} />
{/if}
