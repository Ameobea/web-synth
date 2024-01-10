<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { ADSR2Instance } from 'src/controls/adsr2/adsr2';
  import type { CVOutputState } from 'src/midiEditor/CVOutput/CVOutput';
  import CollapsedCvOutputControls from './CollapsedCVOutputControls.svelte';
  import CVOutputControlsInner from './CVOutputControlsInner.svelte';
  import type { MIDIEditorBaseView } from 'src/midiEditor';

  export let name: string;
  export let setName: (name: string) => void;
  export let state: Writable<CVOutputState>;
  export let deleteOutput: () => void;
  export let registerInstance: (instance: ADSR2Instance) => void;
  export let setFrozenOutputValue: (frozenOutputValue: number) => void;
  export let view: Writable<MIDIEditorBaseView>;
  export let getCursorPosBeats: () => number;
  export let setCursorPosBeats: (newCursorPosBeats: number) => void;

  const expand = () => {
    $state.isExpanded = true;
  };
  const collapse = () => {
    $state.isExpanded = false;
  };
</script>

{#if !$state.isExpanded}
  <CollapsedCvOutputControls {name} {expand} {deleteOutput} {setName} />
{:else}
  <CVOutputControlsInner
    {name}
    {state}
    {collapse}
    {deleteOutput}
    {setName}
    {registerInstance}
    {setFrozenOutputValue}
    view={$view}
    {getCursorPosBeats}
    {setCursorPosBeats}
  />
{/if}
