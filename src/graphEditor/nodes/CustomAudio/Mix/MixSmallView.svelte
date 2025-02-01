<script lang="ts" context="module">
  const SETTINGS: ControlPanelSetting[] = [
    { label: 'input/output type', type: 'select', options: ['audio', 'cv'] },
    { label: 'mix', type: 'range', min: 0, max: 1, step: 0.00001 },
  ];
</script>

<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { MixNode } from './Mix';

  export let node: MixNode;
  $: stateStore = node.state;
  $: state = $stateStore;

  const handleChange = (key: string, val: any) => {
    switch (key) {
      case 'input/output type':
        node.setInputType(val);
        break;
      case 'mix':
        node.setMix(val);
        break;
      default:
        console.error('Unknown state key in MixSmallView:', key);
    }
  };
</script>

<div class="root">
  <SvelteControlPanel {state} onChange={handleChange} settings={SETTINGS} width={500} />
  <code style="padding: 8px; text-align: center">y = (1 - mix) * input_a + mix * input_b</code>
  <p style="padding: 8px; margin-top: 0">
    <i>Supports audio-rate modulation for the mix and inputs/outputs</i>
  </p>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
