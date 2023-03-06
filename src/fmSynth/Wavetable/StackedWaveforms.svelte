<script lang="ts">
  import type { WavetablePreset } from 'src/api';

  export let setActiveWaveformIx: (newIx: number) => void;
  export let addWaveform: () => void;
  export let activeWaveformIx: number;
  export let presetState: WavetablePreset;
</script>

<div class="root">
  {#each presetState.waveforms as _waveform, ix}
    <button on:click={() => setActiveWaveformIx(ix)} class:active={ix === activeWaveformIx}>
      {ix + 1}
    </button>
  {/each}
  <button on:click={addWaveform}>+</button>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }

  .root > button {
    width: 100%;
    height: 30px;
    border: none;
    background-color: #333;
    color: #fff;
    font-size: 14px;
    font-family: sans-serif;
    cursor: pointer;
    user-select: none;
  }

  .root > button.active {
    border: 1px solid #fff;
  }
</style>
