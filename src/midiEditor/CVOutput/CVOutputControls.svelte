<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { ADSR2Instance } from 'src/controls/adsr2/adsr2';
  import type { CVOutputState } from 'src/midiEditor/CVOutput/CVOutput';
  import CollapsedCvOutputControls from './CollapsedCVOutputControls.svelte';
  import CVOutputControlsInner from './CVOutputControlsInner.svelte';
  import type { MIDIEditorBaseView } from 'src/midiEditor';

  interface Props {
    name: string;
    setName: (name: string) => void;
    state: Writable<CVOutputState>;
    deleteOutput: () => void;
    registerInstance: (instance: ADSR2Instance) => void;
    setFrozenOutputValue: (frozenOutputValue: number) => void;
    view: Writable<MIDIEditorBaseView>;
    getCursorPosBeats: () => number;
    setCursorPosBeats: (newCursorPosBeats: number) => void;
    activateDrag: () => void;
  }

  let {
    name,
    setName,
    state,
    deleteOutput,
    registerInstance,
    setFrozenOutputValue,
    view,
    getCursorPosBeats,
    setCursorPosBeats,
    activateDrag
  }: Props = $props();

  const expand = () => {
    $state.isExpanded = true;
  };
  const collapse = () => {
    $state.isExpanded = false;
  };
</script>

{#if !$state.isExpanded}
  <CollapsedCvOutputControls {name} {expand} {deleteOutput} {setName} {activateDrag} />
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
    {activateDrag}
  />
{/if}
