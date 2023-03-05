<script lang="ts" context="module">
  interface BuildWavetableState {
    isPlaying: boolean;
    volumeDb: number;
    frequency: number;
  }

  const buildDefaultBuildWavetableState = (): BuildWavetableState => ({
    isPlaying: false,
    volumeDb: -30,
    frequency: 180,
  });
</script>

<script lang="ts">
  import type { PromiseResolveType } from 'ameo-utils';
  import type * as Comlink from 'comlink';

  import {
    getExistingWavetablePresetTags,
    saveWavetablePreset,
    type WavetablePreset,
  } from 'src/api';
  import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import {
    BUILD_WAVETABLE_INST_WIDTH_PX,
    buildDefaultBuildWavetableInstanceState,
    BuildWavetableInstance,
    BuildWavetableSliderMode,
    type BuildWavetableInstanceState,
  } from 'src/fmSynth/Wavetable/BuildWavetableInstance';
  import StackedWaveforms from 'src/fmSynth/Wavetable/StackedWaveforms.svelte';
  import { WavetableConfiguratorWorker } from 'src/fmSynth/Wavetable/WavetableConfiguratorWorker.worker';
  import { logError } from 'src/sentry';

  export let onSubmit: (val: WavetablePreset) => void;
  export let onCancel: () => void;
  export let initialInstState: BuildWavetableInstanceState | undefined = undefined;
  export let hideSaveControls = false;
  export let worker: Comlink.Remote<WavetableConfiguratorWorker>;

  let sliderMode: BuildWavetableSliderMode = BuildWavetableSliderMode.Magnitude;
  let inst: BuildWavetableInstance | null = null;
  let uiState: BuildWavetableState = buildDefaultBuildWavetableState();
  let presetState: WavetablePreset = { waveforms: [] };
  let activeWaveformIx = 0;

  const setActiveWaveformIx = (newIx: number) => {
    const serialized = inst?.serialize();
    if (serialized) {
      presetState.waveforms[activeWaveformIx].instState = serialized;
    }
    activeWaveformIx = newIx;
    inst?.setState(presetState.waveforms[activeWaveformIx].instState);
  };

  const addWaveform = () => {
    const instState = inst?.serialize() ?? buildDefaultBuildWavetableInstanceState();
    presetState.waveforms.push({
      instState,
      renderedWaveformSamplesBase64: '',
    });
    setActiveWaveformIx(presetState.waveforms.length - 1);
  };

  const buildWavetableInstance = (canvas: HTMLCanvasElement) => {
    const thisInst = new BuildWavetableInstance(canvas, worker, initialInstState);
    if (!presetState.waveforms[0]) {
      presetState.waveforms[0] = {
        instState: thisInst.serialize(),
        renderedWaveformSamplesBase64: '',
      };
    }
    thisInst.setSliderMode(sliderMode);
    thisInst.setVolumeDb(uiState.volumeDb);
    thisInst.setFrequency(uiState.frequency);
    inst = thisInst;

    return { destroy: () => void thisInst.destroy() };
  };

  const handleChange = (key: string, val: any) => {
    switch (key) {
      case 'play':
        uiState.isPlaying = val;
        inst?.setIsPlaying(val);
        break;
      case 'volume db':
        uiState.volumeDb = val;
        inst?.setVolumeDb(val);
        break;
      case 'frequency hz':
        uiState.frequency = val;
        inst?.setFrequency(val);
        break;
      default:
        console.error('unhandled key', key);
    }
  };

  const serialize = (): WavetablePreset => {
    const serialized = inst?.serialize();
    if (serialized) {
      presetState.waveforms[activeWaveformIx].instState = serialized;
    }
    return presetState;
  };

  const savePreset = async () => {
    handleChange('play', false);

    if (!inst) {
      return;
    }

    let presetDescriptor: PromiseResolveType<ReturnType<typeof renderGenericPresetSaverWithModal>>;
    try {
      presetDescriptor = await renderGenericPresetSaverWithModal({
        description: true,
        getExistingTags: getExistingWavetablePresetTags,
      });
    } catch (_err) {
      return;
    }

    try {
      await saveWavetablePreset({
        ...presetDescriptor,
        description: presetDescriptor.description || '',
        tags: presetDescriptor.tags || [],
        serializedWavetableInstState: serialize(),
      });
    } catch (err) {
      logError('Failed to save preset', err as Error);
      alert('Failed to save preset: ' + err);
      return;
    }

    onCancel();
  };

  const loadPresetIntoSynth = () => {
    handleChange('play', false);
    onSubmit(serialize());
  };
</script>

<div class="root">
  <div class="content">
    <StackedWaveforms {addWaveform} {setActiveWaveformIx} {activeWaveformIx} {presetState} />
    <div class="viz-container">
      <canvas
        style="width: ${BUILD_WAVETABLE_INST_WIDTH_PX}px; height: ${BUILD_WAVETABLE_INST_WIDTH_PX}px;"
        use:buildWavetableInstance
      />
      <SvelteControlPanel
        style={{ width: 440 }}
        settings={[
          {
            type: 'button',
            label: `toggle sliders to ${
              sliderMode === BuildWavetableSliderMode.Magnitude ? 'phase' : 'magnitude'
            }`,
            action: () => {
              sliderMode =
                sliderMode === BuildWavetableSliderMode.Magnitude
                  ? BuildWavetableSliderMode.Phase
                  : BuildWavetableSliderMode.Magnitude;
              inst?.setSliderMode(sliderMode);
            },
          },
          { type: 'checkbox', label: 'play' },
          { type: 'range', label: 'frequency hz', min: 10, max: 20_000, scale: 'log' },
          { type: 'range', label: 'volume db', min: -60, max: 0 },
          { type: 'button', label: 'reset waveform', action: () => inst?.reset() },
        ]}
        state={{
          play: uiState.isPlaying,
          'volume db': uiState.volumeDb,
          'frequency hz': uiState.frequency,
        }}
        onChange={handleChange}
      />
    </div>
  </div>
  {#if !hideSaveControls}
    <div class="bottom">
      <SvelteControlPanel
        style={{ height: 100, width: 500 }}
        settings={[
          { type: 'button', label: 'load into synth', action: loadPresetIntoSynth },
          { type: 'button', label: 'save preset', action: savePreset },
          { type: 'button', label: 'cancel', action: onCancel },
        ]}
      />
    </div>
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .content {
    display: flex;
    flex: 1;
    flex-direction: row;
  }

  .content .viz-container {
    display: flex;
    flex-direction: column;
  }

  .bottom {
    display: flex;
    flex: 0;
    align-items: flex-end;
  }
</style>
