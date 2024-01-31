<script lang="ts">
  import { renderSvelteModalWithControls } from 'src/controls/Modal';
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';
  import type {
    WaveformRenderer,
    WaveformSelection,
  } from 'src/granulator/GranulatorUI/WaveformRenderer';
  import ReactShim from 'src/misc/ReactShim.svelte';
  import type { SampleDescriptor } from 'src/sampleLibrary';
  import type { SamplerInstance } from 'src/sampler/SamplerInstance';
  import ConfigureSelection from 'src/sampler/SamplerUI/ConfigureSelection.svelte';
  import ConfirmReset from 'src/sampler/SamplerUI/ConfirmReset.svelte';
  import SelectionListing from 'src/sampler/SamplerUI/SelectionListing.svelte';
  import { buildDefaultSamplerSelection, type SamplerSelection } from 'src/sampler/sampler';
  import { filterNils, msToSamples, samplesToMs } from 'src/util';
  import { onMount } from 'svelte';
  import { type Writable, get } from 'svelte/store';

  export let activeSample: { descriptor: SampleDescriptor; data?: AudioBuffer } | null;
  export let selections: Writable<SamplerSelection[]>;
  export let activeSelectionIx: Writable<number | null>;
  export let inst: SamplerInstance;
  export let clearActiveSample: () => void;
  export let waveformRenderer: WaveformRenderer;

  $: if ($activeSelectionIx === null) {
    waveformRenderer.setSelection({ endMarkPosMs: null, startMarkPosMs: null });
  } else {
    const selection = $selections[$activeSelectionIx];
    waveformRenderer.setSelection({
      startMarkPosMs:
        selection.startSampleIx === null ? null : samplesToMs(selection.startSampleIx),
      endMarkPosMs: selection.endSampleIx === null ? null : samplesToMs(selection.endSampleIx),
    });
  }

  const onWaveformRendererSelectionChange = (newSelection: WaveformSelection) => {
    if ($activeSelectionIx === null) {
      return;
    }

    inst.setSelection($activeSelectionIx, {
      ...$selections[$activeSelectionIx],
      startSampleIx:
        newSelection.startMarkPosMs === null ? null : msToSamples(newSelection.startMarkPosMs),
      endSampleIx:
        newSelection.endMarkPosMs === null ? null : msToSamples(newSelection.endMarkPosMs),
    });
  };
  onMount(() => {
    waveformRenderer.addEventListener('selectionChange', onWaveformRendererSelectionChange);

    return () =>
      void waveformRenderer.removeEventListener(
        'selectionChange',
        onWaveformRendererSelectionChange
      );
  });

  const deleteActiveSelection = () => {
    if ($activeSelectionIx === null) {
      return;
    }

    inst.deleteSelection($activeSelectionIx);
  };

  $: settings = ((): ControlPanelSetting[] =>
    filterNils([
      {
        type: 'button',
        action: () => {
          selections.update(selections => [...selections, buildDefaultSamplerSelection()]);
          if (get(selections).length === 1) {
            activeSelectionIx.set(0);
          }
        },
        label: 'add selection',
      },
      $activeSelectionIx !== null
        ? {
            type: 'button',
            action: deleteActiveSelection,
            label: 'delete selection',
          }
        : null,
      {
        type: 'button',
        action: async () => {
          try {
            await renderSvelteModalWithControls(ConfirmReset, true);
            clearActiveSample();
          } catch (_err) {
            // cancelled
          }
        },
        label: 'reset',
      },
    ]))();

  const handleSelectionChange = (newSelection: SamplerSelection) => {
    if ($activeSelectionIx === null) {
      console.error('no active selection');
      return;
    }

    inst.setSelection($activeSelectionIx, newSelection);
  };
</script>

<div class="root">
  <p style="font-family: 'Hack', monospace; font-size: 14px; margin-top: 4px; margin-bottom: 8px;">
    Active sample: {activeSample?.descriptor.name ?? 'none'}
  </p>
  <div class="main-pane">
    <div style="display: flex; flex-direction: column;">
      <SelectionListing
        selections={$selections}
        activeSelectionIx={$activeSelectionIx}
        setActiveSelectionIx={newSelectionIx => void activeSelectionIx.set(newSelectionIx)}
        getMidiGateStatusBufferF32={() => inst.midiGateStatusBufferF32}
        midiGateStatusUpdated={inst.midiGateStatusUpdated}
      />
      <SvelteControlPanel {settings} />
    </div>
    <div class="configure-selection">
      <div>
        <ReactShim
          Component={SampleEditor}
          props={{
            waveformRenderer,
            disabled: $activeSelectionIx === null,
            style: { marginTop: 0 },
          }}
        />
      </div>
      {#if $activeSelectionIx !== null}
        <ConfigureSelection
          selection={$selections[$activeSelectionIx]}
          selectionIx={$activeSelectionIx}
          onChange={handleSelectionChange}
          {inst}
          getMidiGateStatusBufferF32={() => inst.midiGateStatusBufferF32}
          midiGateStatusUpdated={inst.midiGateStatusUpdated}
        />
      {/if}
    </div>
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }

  .main-pane {
    display: flex;
    flex: 1;
    flex-direction: row;
    margin-top: 20px;
  }

  .configure-selection {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
</style>
