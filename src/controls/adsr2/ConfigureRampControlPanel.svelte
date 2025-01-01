<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { RampFn } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
  import { get, writable, type Writable } from 'svelte/store';

  export let top: number;
  export let left: number;
  export let onCancel: () => void;
  export let onSubmit: (newRampFnType: RampFn['type']) => void;
  export let initialRampFnType: RampFn['type'];

  interface LocalState {
    'ramp fn': RampFn['type'];
  }
  let state: Writable<LocalState> = writable({ 'ramp fn': initialRampFnType });

  const handleSubmit = () => void onSubmit(get(state)['ramp fn']);

  const settings: ControlPanelSetting[] = [
    {
      type: 'select',
      label: 'ramp fn',
      options: ['linear', 'exponential', 'bezier', 'instant'],
    },
    { type: 'button', label: 'cancel', action: onCancel },
    {
      type: 'button',
      label: 'submit',
      action: () => handleSubmit(),
    },
  ];

  const handleChange = (key: string, val: any) => state.update(s => ({ ...s, [key]: val }));
</script>

<div class="adsr2-configure-ramp-control-panel" style="top:{top}px; left:{left}px;">
  <SvelteControlPanel
    {settings}
    state={$state}
    onChange={handleChange}
    theme={{ background1: '#141414' }}
  />
</div>

<style lang="css">
  .adsr2-configure-ramp-control-panel {
    display: flex;
    flex-direction: column;
    transform: scale(0.7);
    transform-origin: top left;
    position: fixed;
    border: 1px solid #888;
    box-sizing: border-box;
    margin-bottom: -1px;
  }

  /* :global(.adsr2-configure-ramp-control-panel .control-panel > .container > :first-child) {
    width: 10% !important;
  }

  :global(.adsr2-configure-ramp-control-panel .control-panel > .container > :nth-child(3)) {
    width: 37% !important;
  } */
</style>
