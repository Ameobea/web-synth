<script lang="ts">
  import type * as Comlink from 'comlink';
  import type React from 'react';

  import { fetchWavetablePresets, type WavetablePresetDescriptor } from 'src/api';
  import {
    mkGenericPresetPicker,
    type CustomPresetInfoProps,
    type PresetDescriptor,
  } from 'src/controls/GenericPresetPicker/GenericPresetPicker';
  import type { WavetableConfiguratorWorker } from 'src/fmSynth/Wavetable/WavetableConfiguratorWorker.worker';
  import WavetablePresetInfo from 'src/fmSynth/Wavetable/WavetablePresetInfo.svelte';
  import ReactShim from 'src/misc/ReactShim.svelte';
  import { addProps } from 'src/reactUtils';
  import { mkSvelteComponentShim } from 'src/svelteUtils';

  export let worker: Comlink.Remote<WavetableConfiguratorWorker>;

  interface WavetablePresetInfoReactProps extends CustomPresetInfoProps<WavetablePresetDescriptor> {
    worker: Comlink.Remote<WavetableConfiguratorWorker>;
  }
  const WavetablePresetInfoReact: React.FC<WavetablePresetInfoReactProps> =
    mkSvelteComponentShim<WavetablePresetInfoReactProps>(WavetablePresetInfo) as any;

  const WavetablePresetPickerReact = mkGenericPresetPicker(
    () =>
      fetchWavetablePresets().then(presets =>
        presets.map(preset => ({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          tags: preset.tags,
          preset,
        }))
      ),
    { width: '100%', height: 'calc(100% - 20px)', boxSizing: 'border-box' },
    addProps(WavetablePresetInfoReact, { worker })
  );

  export let onSubmit: (pickedPreset: PresetDescriptor<WavetablePresetDescriptor>) => void;
  export let onCancel: () => void;
</script>

<ReactShim
  Component={WavetablePresetPickerReact}
  props={{ onSubmit, onCancel }}
  __style="height: calc(100% - 50px)"
/>
