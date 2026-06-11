<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  interface Props {
    onSubmit: (bpm: number) => void;
  }

  let { onSubmit }: Props = $props();

  let isOpen = $state(false);
  let lastTapTime: number | null = $state(null);
  let intervalsMs: number[] = $state([]);
  let bpm =
    $derived(intervalsMs.length > 0
      ? 60000 / (intervalsMs.reduce((acc, curr) => acc + curr) / intervalsMs.length)
      : null);

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
    <button onclick={handleTap}>Tap</button>
    {#if lastTapTime !== null}
      <p>BPM: {bpm === null ? '-' : bpm.toFixed(2)}</p>
      <button onclick={reset}>Reset</button>
      {#if bpm !== null}
        <button
          onclick={() => {
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
      onclick={() => {
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
