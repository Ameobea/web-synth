<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  export let onSubmit: (bpm: number) => void;

  let isOpen = false;
  let lastTapTime: number | null = null;
  let intervalsMs: number[] = [];
  $: bpm =
    intervalsMs.length > 0
      ? 60000 / (intervalsMs.reduce((acc, curr) => acc + curr) / intervalsMs.length)
      : null;

  const handleTap = () => {
    const now = Date.now();
    if (lastTapTime !== null) {
      intervalsMs = [...intervalsMs, now - lastTapTime];
    }
    lastTapTime = now;
  };

  const handleKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === '\\') {
      handleTap();
    }
  };

  const reset = () => {
    lastTapTime = null;
    intervalsMs = [];
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });
</script>

<div class="root">
  {#if isOpen}
    <p>Click the button below to the beat or press the <code>\</code> key.</p>
    <button on:click={handleTap}>Tap</button>
    {#if lastTapTime !== null}
      <p>BPM: {bpm === null ? '-' : bpm.toFixed(2)}</p>
      <button on:click={reset}>Reset</button>
      {#if bpm !== null}
        <button
          on:click={() => {
            isOpen = false;
            onSubmit(bpm);
          }}
        >
          Submit
        </button>
      {/if}
    {/if}
  {:else}
    <button
      on:click={() => {
        isOpen = true;
      }}
    >
      Tap in BPM
    </button>
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
