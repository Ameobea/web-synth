<script lang="ts" module>
  import { filterNils } from 'src/util';

  const buildMappedSampleControlPanelSettings = (
    lenSamples: number | null | undefined
  ): ControlPanelSetting[] =>
    filterNils([
      { label: 'gain', type: 'range', min: 0, max: 5 },
      { label: 'playback rate', type: 'range', min: 0, max: 5, step: 0.1 },
      lenSamples
        ? { label: 'range (samples)', type: 'interval', min: 0, max: lenSamples, step: 1 }
        : null,
    ]);
</script>

<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { MappedSampleData } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
  import { getSample } from 'src/sampleLibrary/sampleLibrary';
  import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';

  interface Props {
    mappedSampleData: MappedSampleData;
    onChange: (newMappedSampleData: MappedSampleData) => void;
    onDelete: () => void;
  }

  let { mappedSampleData, onChange, onDelete }: Props = $props();

  let selectedSampleLength = $state(0);

  $effect(() => {
    if (mappedSampleData.descriptor) {
      let cancelled = false;
      getSample(mappedSampleData.descriptor).then(sample => {
        if (!cancelled) {
          selectedSampleLength = sample.length;
        }
      });
      return () => {
        cancelled = true;
      };
    } else {
      selectedSampleLength = 0;
    }
  });
  let mappedSampleControlPanelSettings = $derived(buildMappedSampleControlPanelSettings(selectedSampleLength));
  let controlPanelState = $derived({
    gain: mappedSampleData.gain ?? 1,
    'playback rate': mappedSampleData.playbackRate ?? 1,
    'range (samples)': [
      mappedSampleData.startIx ?? 0,
      mappedSampleData.endIx ?? selectedSampleLength,
    ],
  });

  const checkboxID = `loop-checkbox-${genRandomStringID()}`;

  const handleControlPanelChange = (key: string, value: any, _state: Record<string, any>) => {
    switch (key) {
      case 'gain':
        onChange({ ...mappedSampleData, gain: value });
        break;
      case 'playback rate':
        onChange({ ...mappedSampleData, playbackRate: value });
        break;
      case 'range (samples)':
        onChange({ ...mappedSampleData, startIx: value[0], endIx: value[1] });
        break;
      default:
        console.error('Unknown key', key);
    }
  };
</script>

<div class="root">
  <div class="selected-sample">
    <b class="label">Selected Sample:</b>
    {#if mappedSampleData.descriptor}<span>{mappedSampleData.descriptor.name}</span>
    {:else}<i class="no-sample-mapped">No sample mapped</i>
    {/if}
  </div>
  <div class="buttons-container">
    <button
      class="select-sample-button"
      onclick={async () => {
        try {
          const selectedSample = await selectSample();
          onChange({ ...mappedSampleData, descriptor: selectedSample });
          // TODO: Deal with load status??
        } catch (err) {
          // pass
        }
      }}
    >
      Pick Sample
    </button>
    <button style="margin-left: 8px;" onclick={onDelete}>Delete</button>
    <label class="loop-checkbox-label" for={checkboxID}>Loop</label>
    <input
      id={checkboxID}
      type="checkbox"
      checked={mappedSampleData.doLoop}
      onchange={evt => onChange({ ...mappedSampleData, doLoop: evt.currentTarget.checked })}
    />
    {#if mappedSampleData.descriptor}
      <SvelteControlPanel
        settings={mappedSampleControlPanelSettings}
        state={controlPanelState}
        onChange={handleControlPanelChange}
        style={{ width: '100%', marginTop: 8 }}
      />
    {/if}
  </div>
</div>

<style lang="css">
  .root {
    margin-left: -2px;
    margin-right: -2px;
    margin-top: -2px;
    display: flex;
    flex-direction: column;
    padding: 8px;
    border: 1px solid #888;
  }

  .selected-sample {
    display: flex;
    flex-direction: row;
    margin-bottom: -1px;
  }

  .selected-sample .label {
    margin-right: 8px;
  }

  .no-sample-mapped {
    color: #999;
  }

  button {
    height: 26px;
  }

  .select-sample-button {
    width: 140px;
    margin-top: 8px;
  }

  .loop-checkbox-label {
    margin-left: 8px;
  }
</style>
