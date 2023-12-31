<script lang="ts" context="module">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import { SamplerSelection } from 'src/sampler/sampler';
  import { MIDINumberDisplay } from './MIDINumberDisplay';
</script>

<script lang="ts">
  import LearnMidiMapping from 'src/sampler/SamplerUI/LearnMIDIMapping.svelte';
  import type { SamplerInstance } from 'src/sampler/SamplerInstance';

  export let selection: SamplerSelection;
  export let selectionIx: number;
  export let onChange: (newSelection: SamplerSelection) => void;
  export let inst: SamplerInstance;

  let isLearningMIDIMapping = false;

  $: settings = ((): ControlPanelSetting[] => {
    const settings: ControlPanelSetting[] = [{ label: 'name', type: 'text' }];

    if (selection.startSampleIx !== null && selection.endSampleIx !== null) {
      settings.push(
        { label: 'start crossfade len samples', type: 'range', min: 0, max: 1000 },
        { label: 'end crossfade len samples', type: 'range', min: 0, max: 1000 },
        { label: 'midi number', type: 'custom', Comp: MIDINumberDisplay },
        {
          label:
            typeof selection.midiNumber === 'number' ? 'update midi mapping' : 'learn midi mapping',
          type: 'button',
          action: () => {
            isLearningMIDIMapping = true;
          },
          disabled: isLearningMIDIMapping,
        }
      );
    }

    return settings;
  })();

  $: state = {
    name: selection.name ?? '',
    'start crossfade len samples': selection.startCrossfadeLenSamples,
    'end crossfade len samples': selection.endCrossfadeLenSamples,
    'midi number': selection.midiNumber,
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
{#if isLearningMIDIMapping}
  <LearnMidiMapping
    {selectionIx}
    {inst}
    onLearned={learnedMIDINumber => {
      isLearningMIDIMapping = false;
      onChange({ ...selection, midiNumber: learnedMIDINumber });
    }}
    onCanceled={() => {
      isLearningMIDIMapping = false;
    }}
  />
{/if}
