<script lang="ts" context="module">
  const buildSettings = (): ControlPanelSetting[] => [
    { type: 'checkbox', label: 'enable safety limiter' },
  ];
</script>

<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { CustomAudioDestinationNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';

  export let node: CustomAudioDestinationNode;

  $: settings = buildSettings();
</script>

<div class="root">
  <SvelteControlPanel title="destination settings" {settings} width={500} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
