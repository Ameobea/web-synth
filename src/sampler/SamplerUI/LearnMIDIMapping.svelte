<script lang="ts">
  import type { SamplerInstance } from 'src/sampler/SamplerInstance';
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { delay } from 'src/util';

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

  let cancelled = false;
  onDestroy(() => {
    cancelled = true;
  });

  onMount(async () => {
    while (!cancelled) {
      let midiNumber: number;
      try {
        midiNumber = await inst.captureNextMIDIAttack();
      } catch {
        // AWP not yet initialized; wait for it and retry
        await delay(50);
        continue;
      }
      if (cancelled) {
        return;
      }
      capturedMIDINumber = midiNumber;
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
