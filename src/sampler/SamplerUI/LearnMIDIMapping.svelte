<script lang="ts">
  import type { SamplerInstance } from 'src/sampler/SamplerInstance';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  export let selectionIx: number;
  export let inst: SamplerInstance;
  export let onLearned: (midiNumber: number) => void;
  export let onCanceled: () => void;
  $: selections = inst.selections;

  let capturedMIDINumber: number | null = null;
  $: conflictingSelectionIx = $selections.findIndex(
    (sel, ix) => ix !== selectionIx && sel.midiNumber === capturedMIDINumber
  );

  onMount(async () => {
    while (true) {
      capturedMIDINumber = await inst.captureNextMIDIAttack();
      if (
        !get(selections).some(
          (sel, ix) => ix !== selectionIx && sel.midiNumber === capturedMIDINumber
        )
      ) {
        onLearned(capturedMIDINumber);
        break;
      }
    }
  });
</script>

<div class="root">
  {#if capturedMIDINumber === null}
    <p>Listening for MIDI events...</p>
  {:else if conflictingSelectionIx !== -1}
    <p style="color: orange">
      MIDI number already mapped to selection {$selections[conflictingSelectionIx].name ??
        `<${conflictingSelectionIx}>`}
    </p>
  {/if}

  <button on:click={onCanceled} style="width: 80px">Cancel</button>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
