<script lang="ts" context="module">
  interface BuildWavetableState {
    isPlaying: boolean;
    volumeDb: number;
    wavetablePosition: number;
    frequency: number;
    enableCodeEditor: boolean;
  }

  const buildDefaultBuildWavetableState = (): BuildWavetableState => ({
    isPlaying: false,
    volumeDb: -30,
    wavetablePosition: 0,
    frequency: 180,
    enableCodeEditor: false,
  });

  const DEFAULT_WAVETABLE_SOURCE_CODE = `// Sawtooth wave
return new Array(64).fill(null).map((_, i) => i === 0 ? 0 : (1 / i));
`;
</script>

<script lang="ts">
  import type * as Comlink from 'comlink';

  import {
    getExistingWavetablePresetTags,
    saveWavetablePreset,
    type WavetablePreset,
  } from 'src/api';
  import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import SvelteCodeEditor from 'src/faustEditor/SvelteCodeEditor.svelte';
  import {
    BUILD_WAVETABLE_INST_HEIGHT_PX,
    BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES,
    BUILD_WAVETABLE_INST_WIDTH_PX,
    buildDefaultBuildWavetableInstanceState,
    BuildWavetableInstance,
    BuildWavetableSliderMode,
  } from 'src/fmSynth/Wavetable/BuildWavetableInstance';
  import StackedWaveforms from 'src/fmSynth/Wavetable/StackedWaveforms.svelte';
  import type { WavetableConfiguratorWorker } from 'src/fmSynth/Wavetable/WavetableConfiguratorWorker.worker';
  import { HARMONICS_COUNT } from 'src/fmSynth/Wavetable/conf';
  import { logError } from 'src/sentry';
  import type { PromiseResolveType } from 'src/util';

  export let onSubmit: (val: WavetablePreset) => void;
  export let onCancel: () => void;
  export let initialInstState: WavetablePreset | undefined = undefined;
  export let hideSaveControls = false;
  export let worker: Comlink.Remote<WavetableConfiguratorWorker>;

  let sliderMode: BuildWavetableSliderMode = BuildWavetableSliderMode.Magnitude;
  let inst: BuildWavetableInstance | null = null;
  let uiState: BuildWavetableState = {
    ...buildDefaultBuildWavetableState(),
    enableCodeEditor: !!initialInstState?.sourceCode,
  };
  let presetState: WavetablePreset = {
    waveforms: initialInstState?.waveforms ?? [
      { instState: buildDefaultBuildWavetableInstanceState(), renderedWaveformSamplesBase64: '' },
    ],
    sourceCode: initialInstState?.sourceCode ?? DEFAULT_WAVETABLE_SOURCE_CODE,
  };
  let isExecutingCode = false;
  const renderedWavetableRef = {
    renderedWavetable: [
      new Float32Array(BUILD_WAVETABLE_INST_WAVEFORM_LENGTH_SAMPLES * presetState.waveforms.length),
    ],
  };
  let activeWaveformIx = 0;

  let lastInitialInstState: WavetablePreset | undefined = undefined;
  $: if (initialInstState && initialInstState !== lastInitialInstState) {
    lastInitialInstState = initialInstState;
    presetState.waveforms = initialInstState.waveforms;
    inst?.setState(presetState.waveforms[activeWaveformIx].instState);

    worker
      .renderWavetable(presetState.waveforms.map(w => w.instState))
      .then(newRenderedWaveformSamples => {
        renderedWavetableRef.renderedWavetable = newRenderedWaveformSamples;
      })
      .catch(err => void logError('Error rendering initial wavetable', err));
  }

  const setActiveWaveformIx = (newIx: number, skipSerialize?: boolean) => {
    if (!skipSerialize) {
      const serialized = inst?.serialize();
      if (serialized) {
        presetState.waveforms[activeWaveformIx].instState = serialized;
      }
    }
    activeWaveformIx = newIx;

    uiState.wavetablePosition =
      presetState.waveforms.length <= 1 ? 0.5 : newIx / (presetState.waveforms.length - 1);
    inst?.setWavetablePosition(uiState.wavetablePosition);
    inst?.setActiveWaveformIx(activeWaveformIx);
    inst?.setState(presetState.waveforms[activeWaveformIx].instState);
  };

  let isAddingOrRemovingWaveform = false;
  const addWaveform = async () => {
    if (isAddingOrRemovingWaveform) {
      return;
    }
    isAddingOrRemovingWaveform = true;

    try {
      const instState = inst?.serialize() ?? buildDefaultBuildWavetableInstanceState();
      presetState.waveforms.push({
        instState,
        renderedWaveformSamplesBase64: '',
      });
      const newRenderedWaveformSamples: Float32Array[] = await worker.renderWavetable(
        presetState.waveforms.map(w => w.instState)
      );
      renderedWavetableRef.renderedWavetable = newRenderedWaveformSamples;

      setActiveWaveformIx(presetState.waveforms.length - 1);
    } catch (err) {
      logError('Error adding waveform', err);
    } finally {
      isAddingOrRemovingWaveform = false;
    }
  };

  const deleteWaveform = async (ix: number) => {
    if (presetState.waveforms.length === 1) {
      return;
    }

    if (isAddingOrRemovingWaveform) {
      return;
    }
    isAddingOrRemovingWaveform = true;

    presetState.waveforms.splice(ix, 1);
    presetState.waveforms = [...presetState.waveforms];

    try {
      const newRenderedWaveformSamples: Float32Array[] = await worker.renderWavetable(
        presetState.waveforms.map(w => w.instState)
      );
      renderedWavetableRef.renderedWavetable = newRenderedWaveformSamples;
    } catch (err) {
      logError('Error removing waveform', err);
    } finally {
      isAddingOrRemovingWaveform = false;
    }

    setActiveWaveformIx(presetState.waveforms.length - 1, true);
  };

  const buildWavetableInstance = (canvas: HTMLCanvasElement) => {
    const thisInst = new BuildWavetableInstance(
      canvas,
      worker,
      renderedWavetableRef,
      presetState.waveforms[0].instState
    );
    if (!presetState.waveforms[0]) {
      presetState.waveforms[0] = {
        instState: thisInst.serialize(),
        renderedWaveformSamplesBase64: '',
      };
    }
    thisInst.setSliderMode(sliderMode);
    thisInst.setVolumeDb(uiState.volumeDb);
    thisInst.setFrequency(uiState.frequency);
    thisInst.setWavetablePosition(uiState.wavetablePosition);
    thisInst.setActiveWaveformIx(activeWaveformIx);
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
      case 'wavetable position':
        uiState.wavetablePosition = val;
        inst?.setWavetablePosition(val);
        break;
      case 'enable code editor':
        uiState.enableCodeEditor = val;
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
        width={BUILD_WAVETABLE_INST_WIDTH_PX}
        height={BUILD_WAVETABLE_INST_HEIGHT_PX}
        style="max-width: {BUILD_WAVETABLE_INST_WIDTH_PX}px; max-height: {BUILD_WAVETABLE_INST_HEIGHT_PX}px;"
        use:buildWavetableInstance
      />
      <div class="controls-container">
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
            { type: 'range', label: 'wavetable position', min: 0, max: 1, step: 0.0001 },
            { type: 'range', label: 'frequency hz', min: 10, max: 20_000, scale: 'log' },
            { type: 'range', label: 'volume db', min: -60, max: 0 },
            { type: 'button', label: 'reset waveform', action: () => inst?.reset() },
            {
              type: 'button',
              label: 'delete waveform',
              action: () => deleteWaveform(activeWaveformIx),
            },
            { type: 'checkbox', label: 'enable code editor' },
          ]}
          state={{
            play: uiState.isPlaying,
            'wavetable position': uiState.wavetablePosition,
            'volume db': uiState.volumeDb,
            'frequency hz': uiState.frequency,
            'enable code editor': uiState.enableCodeEditor,
          }}
          onChange={handleChange}
        />
        {#if uiState.enableCodeEditor}
          <div class="code-editor-container">
            <SvelteCodeEditor
              value={presetState.sourceCode ?? ''}
              onChange={newSourceCode => {
                presetState.sourceCode = newSourceCode;
              }}
              mode="javascript"
            />
            <SvelteControlPanel
              style={{ width: 440 }}
              settings={[
                {
                  type: 'button',
                  label: 'execute',
                  action: async () => {
                    if (isExecutingCode) {
                      return;
                    }
                    isExecutingCode = true;

                    try {
                      const fn = new Function(presetState.sourceCode ?? '');
                      const harmonicAmplitudes = fn();
                      if (!Array.isArray(harmonicAmplitudes)) {
                        throw new Error('Provided code did not return an array');
                      }

                      // Currently expect each harmonic to be a number
                      if (!harmonicAmplitudes.every(h => typeof h === 'number')) {
                        throw new Error('Provided code did not return an array of numbers');
                      }

                      // Pad/clamp to expected length
                      while (harmonicAmplitudes.length < HARMONICS_COUNT) {
                        harmonicAmplitudes.push(0);
                      }
                      while (harmonicAmplitudes.length > HARMONICS_COUNT) {
                        harmonicAmplitudes.pop();
                      }

                      const harmonics = harmonicAmplitudes.map(amp => ({
                        magnitude: amp,
                        phase: 0,
                      }));
                      const rendered = await worker.renderWavetable([{ harmonics }]);
                      renderedWavetableRef.renderedWavetable = rendered;
                      inst?.setState({ harmonics, sliderMode });
                    } catch (err) {
                      alert(`Error executing code: ${err}`);
                    } finally {
                      isExecutingCode = false;
                    }
                  },
                },
              ]}
            />
          </div>
        {/if}
      </div>
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

  .controls-container {
    display: flex;
    flex-direction: row;
  }

  .bottom {
    display: flex;
    flex: 0;
    align-items: flex-end;
  }
</style>
