<script lang="ts" context="module">
  export enum RegateMode {
    AnyAttack = 'AnyAttack',
    NoNotesHeld = 'NoNotesHeld',
  }

  const settings: ControlPanelSetting[] = [
    {
      type: 'select',
      label: 'gate mode',
      options: {
        'on any attack': RegateMode.AnyAttack,
        'when no notes currently held': RegateMode.NoNotesHeld,
      },
    },
  ];
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import { type MIDIToFrequencyState } from 'src/graphEditor/nodes/CustomAudio/MIDIToFrequency/MIDIToFrequency';

  export let state: Writable<MIDIToFrequencyState>;
  $: localState = { 'gate mode': $state.regateMode };

  const handleChange = (_key: string, _val: any, newState: Record<string, any>) => {
    state.set({ regateMode: newState['gate mode'] });
  };
</script>

<div class="root">
  <SvelteControlPanel
    {settings}
    state={localState}
    style={{ width: 500 }}
    onChange={handleChange}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    width: 500px;
  }
</style>
