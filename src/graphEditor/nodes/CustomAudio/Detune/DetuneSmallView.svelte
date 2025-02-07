<script lang="ts">
  import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { DetuneNode } from './DetuneNode';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';

  export let node: DetuneNode;

  let settings: ControlPanelSetting[] = [];
  $: settings = [{ label: 'detune (cents)', type: 'range', min: -1200, max: 1200, step: 1 }];

  const handleChange = (key: string, value: any) => {
    switch (key) {
      case 'detune (cents)':
        node.setDetuneCents(value);
        break;
      default:
        console.error(`Unhandled key in \`DetuneSmallView\`: ${key}`);
    }
  };

  $: stateStore = node.state;
  $: nodeState = $stateStore;

  $: state = { 'detune (cents)': nodeState.detuneCents };
</script>

<div class="root">
  <SvelteControlPanel {settings} {state} onChange={handleChange} width={500} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
