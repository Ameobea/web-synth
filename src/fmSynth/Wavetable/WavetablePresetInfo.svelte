<script lang="ts">
  import type * as Comlink from 'comlink';

  import { getWavetablePreset, type WavetablePresetDescriptor } from 'src/api';
  import type { PresetDescriptor } from 'src/controls/GenericPresetPicker/GenericPresetPicker';
  import BuildWavetable from 'src/fmSynth/Wavetable/BuildWavetable.svelte';
  import type { WavetableConfiguratorWorker } from 'src/fmSynth/Wavetable/WavetableConfiguratorWorker.worker';
  import { UnreachableError } from 'src/util';

  export let preset: PresetDescriptor<WavetablePresetDescriptor>;
  export let worker: Comlink.Remote<WavetableConfiguratorWorker>;

  let lastPresetID: number | undefined = preset.preset.id;
  let fetchedPreset = getWavetablePreset(preset.preset.id);
  $: if (preset.preset.id !== lastPresetID) {
    lastPresetID = preset.preset.id;
    fetchedPreset = getWavetablePreset(preset.preset.id);
  }
</script>

{#await fetchedPreset}
  Loading...
{:then preset}
  <div class="spacer" style="height: 10px" />
  <BuildWavetable
    onSubmit={() => {
      throw new UnreachableError();
    }}
    onCancel={() => {
      throw new UnreachableError();
    }}
    hideSaveControls
    initialInstState={preset}
    {worker}
  />
{:catch error}
  <div style="color: red">
    Error fetching preset: {error.message}
  </div>
{/await}
