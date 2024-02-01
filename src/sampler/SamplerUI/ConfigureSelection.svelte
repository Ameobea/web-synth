<script lang="ts" context="module">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { SamplerSelection } from 'src/sampler/sampler';
  import { mkMIDINumberDisplay } from './MIDINumberDisplay';
</script>

<script lang="ts">
  import LearnMidiMapping from 'src/sampler/SamplerUI/LearnMIDIMapping.svelte';
  import type { SamplerInstance } from 'src/sampler/SamplerInstance';
  import type { Writable } from 'svelte/store';

  export let selection: SamplerSelection;
  export let selectionIx: number;
  export let onChange: (newSelection: SamplerSelection) => void;
  export let inst: SamplerInstance;
  export let getMidiGateStatusBufferF32: () => Float32Array | null;
  export let midiGateStatusUpdated: Writable<number>;

  let isLearningMIDIMapping = false;

  $: settings = ((): ControlPanelSetting[] => {
    const settings: ControlPanelSetting[] = [{ label: 'name', type: 'text' }];

    if (selection.startSampleIx !== null && selection.endSampleIx !== null) {
      settings.push(
        { label: 'start crossfade len samples', type: 'range', min: 0, max: 1000 },
        { label: 'end crossfade len samples', type: 'range', min: 0, max: 1000 },
        { label: 'playback rate', type: 'range', min: 0.1, max: 2, step: 0.05 },
        { label: 'reverse', type: 'checkbox' },
        {
          label: 'midi number',
          type: 'custom',
          Comp: mkMIDINumberDisplay(
            getMidiGateStatusBufferF32,
            midiGateStatusUpdated,
            selection.midiNumber
          ),
        },
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
    'playback rate': selection.playbackRate,
    reverse: selection.reverse,
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
      case 'playback rate':
        newSelection.playbackRate = val;
        break;
      case 'reverse':
        newSelection.reverse = val;
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
