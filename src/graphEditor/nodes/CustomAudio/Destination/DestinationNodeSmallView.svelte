<script lang="ts" context="module">
  const buildSettings = (): ControlPanelSetting[] => [
    { type: 'checkbox', label: 'enable safety limiter' },
  ];
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type {
    CustomDestinationNode,
    CustomDestinationNodeState,
  } from 'src/graphEditor/nodes/CustomAudio/Destination/CustomDestinationNode';

  export let node: CustomDestinationNode;
  export let state: Writable<CustomDestinationNodeState>;

  const handleChange = (key: string, val: any, _state: any) => {
    switch (key) {
      case 'enable safety limiter':
        $state.safetyLimiterEnabled = val;
        node.setSafetyLimiterEnabled(val);
        break;
      default:
        console.error(`Unknown setting key in custom destination node small view: ${key}`);
    }
  };

  $: settings = buildSettings();
  $: controlPanelState = { 'enable safety limiter': $state.safetyLimiterEnabled };
</script>

<div class="root">
  <SvelteControlPanel
    title="destination settings"
    {settings}
    width={500}
    state={controlPanelState}
    onChange={handleChange}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
