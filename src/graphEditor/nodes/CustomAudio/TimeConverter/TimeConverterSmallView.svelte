<script lang="ts" context="module">
  const AVAILABLE_UNITS = ['samples', 'beats', 'seconds', 'milliseconds', 'hz', 'bpm'];
</script>

<script lang="ts">
  import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { TimeConverterNode } from './TimeConverterNode';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';

  export let node: TimeConverterNode;

  let settings: ControlPanelSetting[] = [];
  $: settings = [
    { label: 'from unit', type: 'select', options: AVAILABLE_UNITS },
    { label: 'to unit', type: 'select', options: AVAILABLE_UNITS },
  ];

  const handleChange = (key: string, value: any) => {
    switch (key) {
      case 'from unit':
        node.setFromUnit(value);
        break;
      case 'to unit':
        node.setToUnit(value);
        break;
      default:
        console.error(`Unhandled key in \`TimeConverterSmallView\`: ${key}`);
    }
  };
  $: stateStore = node.state;
  $: nodeState = $stateStore;

  $: state = { 'from unit': nodeState.fromUnit, 'to unit': nodeState.toUnit };
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
