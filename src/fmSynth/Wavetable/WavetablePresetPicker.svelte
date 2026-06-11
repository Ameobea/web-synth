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
  import { mkSvelteComponentShim } from 'src/svelteUtils.svelte';


  interface WavetablePresetInfoReactProps extends CustomPresetInfoProps<WavetablePresetDescriptor> {
    worker: Comlink.Remote<WavetableConfiguratorWorker>;
  }
  const WavetablePresetInfoReact: React.FC<WavetablePresetInfoReactProps> =
    mkSvelteComponentShim<WavetablePresetInfoReactProps>(WavetablePresetInfo) as any;

  interface Props {
    worker: Comlink.Remote<WavetableConfiguratorWorker>;
    onSubmit: (pickedPreset: PresetDescriptor<WavetablePresetDescriptor>) => void;
    onCancel: () => void;
  }

  let { worker, onSubmit, onCancel }: Props = $props();

  let WavetablePresetPickerReact = $derived(
    mkGenericPresetPicker(
      () =>
        fetchWavetablePresets().then(presets =>
          presets.map(preset => ({
            id: preset.id,
            name: preset.name,
            description: preset.description,
            tags: preset.tags,
            preset,
            isFeatured: preset.isFeatured,
          }))
        ),
      { width: '100%', height: 'calc(100% - 20px)', boxSizing: 'border-box' },
      addProps(WavetablePresetInfoReact, { worker })
    )
  );
</script>

<ReactShim
  Component={WavetablePresetPickerReact}
  props={{ onSubmit, onCancel }}
  __style="height: calc(100% - 50px)"
/>
