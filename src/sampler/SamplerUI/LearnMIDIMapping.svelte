<script lang="ts">
  import type { SamplerInstance } from 'src/sampler/SamplerInstance';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  interface Props {
    selectionIx: number;
    inst: SamplerInstance;
    onLearned: (midiNumber: number) => void;
    onCanceled: () => void;
  }

  let {
    selectionIx,
    inst,
    onLearned,
    onCanceled
  }: Props = $props();
  let selections = $derived(inst.selections);

  let capturedMIDINumber: number | null = $state(null);
  let conflictingSelectionIx = $derived($selections.findIndex(
    (sel, ix) => ix !== selectionIx && sel.midiNumber === capturedMIDINumber
  ));

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

  <button onclick={onCanceled} style="width: 80px">Cancel</button>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
