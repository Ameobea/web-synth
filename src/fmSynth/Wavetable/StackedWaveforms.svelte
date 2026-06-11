<script lang="ts">
  import type { WavetablePreset } from 'src/api';

  interface Props {
    setActiveWaveformIx: (newIx: number) => void;
    addWaveform: () => void;
    activeWaveformIx: number;
    presetState: WavetablePreset;
  }

  let {
    setActiveWaveformIx,
    addWaveform,
    activeWaveformIx,
    presetState
  }: Props = $props();
</script>

<div class="root">
  {#each presetState.waveforms as _waveform, ix}
    <button onclick={() => setActiveWaveformIx(ix)} class:active={ix === activeWaveformIx}>
      {ix + 1}
    </button>
  {/each}
  <button onclick={addWaveform}>+</button>
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
