<script lang="ts">
  import type * as Comlink from 'comlink';

  import { getWavetablePreset, type WavetablePresetDescriptor } from 'src/api';
  import type { PresetDescriptor } from 'src/controls/GenericPresetPicker/GenericPresetPicker';
  import BuildWavetable from 'src/fmSynth/Wavetable/BuildWavetable.svelte';
  import type { WavetableConfiguratorWorker } from 'src/fmSynth/Wavetable/WavetableConfiguratorWorker.worker';
  import { UnreachableError } from 'src/util';

  interface Props {
    preset: PresetDescriptor<WavetablePresetDescriptor>;
    worker: Comlink.Remote<WavetableConfiguratorWorker>;
  }

  let { preset, worker }: Props = $props();

  let fetchedPreset = $derived(getWavetablePreset(preset.preset.id));
</script>

{#await fetchedPreset}
  Loading...
{:then preset}
  <div class="spacer" style="height: 10px"></div>
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
