<script lang="ts">
  import type { Writable } from 'svelte/store';

  import { MultibandCompressorControls } from 'src/controls/MultibandCompressor';
  import CompressorControlPanel from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorControlPanel.svelte';
  import type { CompressorNodeUIState } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';

  export let store: Writable<CompressorNodeUIState>;

  const renderMultibandCompressor = (canvas: HTMLCanvasElement) => {
    const controls = new MultibandCompressorControls(canvas, store);

    return { destroy: () => controls.dispose() };
  };
</script>

<div class="root">
  <canvas use:renderMultibandCompressor width={500} height={800} />
  <CompressorControlPanel
    state={$store.low}
    onChange={newState => {
      $store.low = newState;
    }}
    ix={0}
  />
  <CompressorControlPanel
    state={$store.mid}
    onChange={newState => {
      $store.mid = newState;
    }}
    ix={1}
  />
  <CompressorControlPanel
    state={$store.high}
    onChange={newState => {
      $store.high = newState;
    }}
    ix={2}
  />
</div>

<style lang="css">
  .root {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }
</style>
