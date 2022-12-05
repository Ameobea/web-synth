<script lang="ts">
  import type { Writable } from 'svelte/store';

  import { MultibandCompressorControls } from 'src/controls/MultibandCompressor';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import CompressorControlPanel from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorControlPanel.svelte';
  import {
    buildDefaultCompressorNodeUIState,
    type CompressorNodeUIState,
  } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';

  export let store: Writable<CompressorNodeUIState>;

  const renderMultibandCompressor = (canvas: HTMLCanvasElement) => {
    const controls = new MultibandCompressorControls(canvas, store);

    return { destroy: () => controls.dispose() };
  };

  const reset = () => store.set(buildDefaultCompressorNodeUIState());
</script>

<div class="root">
  <SvelteControlPanel
    style={{ position: 'absolute', top: 0, left: 0 }}
    settings={[
      { label: 'bypass', type: 'checkbox' },
      { label: 'reset', type: 'button', action: reset },
    ]}
    state={{ bypass: $store.bypass }}
    onChange={(_key, val) => store.update(state => ({ ...state, bypass: val }))}
  />
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
