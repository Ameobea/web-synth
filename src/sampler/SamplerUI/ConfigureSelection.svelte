<script lang="ts" context="module">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import { SamplerSelection } from 'src/sampler/sampler';
</script>

<script lang="ts">
  export let selection: SamplerSelection;
  export let onChange: (newSelection: SamplerSelection) => void;

  $: settings = ((): ControlPanelSetting[] => {
    const settings: ControlPanelSetting[] = [{ label: 'name', type: 'text' }];

    if (selection.startSampleIx !== null && selection.endSampleIx !== null) {
      settings.push(
        { label: 'start crossfade len samples', type: 'range', min: 0, max: 1000 },
        { label: 'end crossfade len samples', type: 'range', min: 0, max: 1000 }
      );
    }

    return settings;
  })();

  $: state = {
    name: selection.name ?? '',
    'start crossfade len samples': selection.startCrossfadeLenSamples,
    'end crossfade len samples': selection.endCrossfadeLenSamples,
  };

  const handleChange = (key: string, val: any) => {
    const newSelection = { ...selection };
    switch (key) {
      case 'start crossfade len samples':
        newSelection.startCrossfadeLenSamples = val;
        break;
      case 'end crossfade len samples':
        newSelection.endCrossfadeLenSamples = val;
        break;
      case 'name':
        newSelection.name = val;
        break;
      default:
        console.error(`unrecognized key in \`ConfigureSelection\`: ${key}`);
        return;
    }
    onChange(newSelection);
  };
</script>

<SvelteControlPanel {settings} onChange={handleChange} {state} style={{ width: 600 }} />
