<script context="module" lang="ts">
  enum Route {
    BrowseWavetables,
    ImportWavetable,
    BuildWavetable,
  }
</script>

<script lang="ts">
  import * as Comlink from 'comlink';

  import {
    getWavetablePreset,
    type WavetablePreset,
    type WavetablePresetDescriptor,
  } from 'src/api';
  import type { PresetDescriptor } from 'src/controls/GenericPresetPicker/GenericPresetPicker';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { WavetableBank } from 'src/fmSynth/ConfigureOperator';
  import BuildWavetable from 'src/fmSynth/Wavetable/BuildWavetable.svelte';
  import { BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES } from 'src/fmSynth/Wavetable/BuildWavetableInstance';
  import { WavetableConfiguratorWorker } from 'src/fmSynth/Wavetable/WavetableConfiguratorWorker.worker';
  import WavetablePresetPicker from 'src/fmSynth/Wavetable/WavetablePresetPicker.svelte';
  import ReactShim from 'src/misc/ReactShim.svelte';
  import { logError } from 'src/sentry';
  import { SAMPLE_RATE } from 'src/util';
  import { WrappedUploadWavetableModal } from './ImportWavetableShim';

  export let onSubmit: (val: WavetableBank) => void;
  export let onCancel: () => void;
  export let curPreset: WavetablePreset | undefined = undefined;

  const worker: Comlink.Remote<WavetableConfiguratorWorker> = Comlink.wrap(
    new Worker(new URL('./WavetableConfiguratorWorker.worker.ts', import.meta.url))
  );

  let initialPreset = curPreset;
  let route: Route = initialPreset ? Route.BuildWavetable : Route.BrowseWavetables;

  const renderPresetToBank = async (
    preset: WavetablePreset,
    name?: string
  ): Promise<WavetableBank> => {
    const rendered: Float32Array[] = await worker.renderWavetable(
      preset.waveforms.map(w => w.instState)
    );
    // FM synth is hard-coded to two wavetable dimensions currently, but all presets are currently 1 dimension.
    //
    // So, we concat all the samples and then duplicate the dimension.
    const concatenatedSamples = new Float32Array(
      BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES * preset.waveforms.length * 2
    );
    for (let i = 0; i < preset.waveforms.length; i++) {
      concatenatedSamples.set(rendered[i], i * BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES);
      concatenatedSamples.set(
        rendered[i],
        (i + preset.waveforms.length) * BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES
      );
    }

    return {
      baseFrequency: SAMPLE_RATE / BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES,
      name: name ?? 'untitled wavetable',
      samples: concatenatedSamples,
      samplesPerWaveform: BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES,
      waveformsPerDimension: preset.waveforms.length,
      preset,
    };
  };

  let isSubmitting = false;
  const handleBuildWavetableSubmit = async (preset: WavetablePreset, name?: string) => {
    if (isSubmitting) {
      return;
    }
    isSubmitting = true;

    try {
      const bank = await renderPresetToBank(preset, name);
      onSubmit(bank);
    } catch (err) {
      logError('Error rendering waveform', err);
    } finally {
      isSubmitting = false;
    }
  };

  const handleLoadPresetIntoSynth = async (
    pickedPreset: PresetDescriptor<WavetablePresetDescriptor>
  ) => {
    try {
      const preset = await getWavetablePreset(pickedPreset.preset.id);
      handleBuildWavetableSubmit(preset, pickedPreset.preset.name);
    } catch (err) {
      logError('Error loading preset', err);
      alert(`Error loading preset: ${err}`);
    }
  };
</script>

<div class="root basic-modal">
  {#if route === Route.BrowseWavetables}
    <WavetablePresetPicker {onCancel} onSubmit={handleLoadPresetIntoSynth} {worker} />
    <SvelteControlPanel
      settings={[
        {
          type: 'button',
          label: 'build new wavetable',
          action: () => {
            route = Route.BuildWavetable;
          },
        },
        {
          type: 'button',
          label: 'import wavetable',
          action: () => {
            route = Route.ImportWavetable;
          },
        },
      ]}
    />
  {:else if route === Route.ImportWavetable}
    <h1>Import Wavetable</h1>
    <ReactShim
      Component={WrappedUploadWavetableModal}
      props={{
        onSubmit,
        onCancel: () => {
          route = Route.BrowseWavetables;
        },
      }}
    />
  {:else if route === Route.BuildWavetable}
    <BuildWavetable
      initialInstState={curPreset}
      onSubmit={handleBuildWavetableSubmit}
      onCancel={() => {
        initialPreset = undefined;
        route = Route.BrowseWavetables;
      }}
      {worker}
    />
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    height: 100%;
    flex-direction: column;
    width: 94vw;
    height: 92vh;
    background-color: #222;
  }
</style>
