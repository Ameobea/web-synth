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
  import { MixerLevelsViz } from 'src/graphEditor/nodes/CustomAudio/mixer/MixerLevelsViz';
  import { onDestroy } from 'svelte';

  export let node: CustomDestinationNode;
  export let state: Writable<CustomDestinationNodeState>;
  export let sab: Writable<Float32Array | null>;

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

  let canvasRef: HTMLCanvasElement | null = null;
  let vizInst: MixerLevelsViz | null = null;

  $: {
    if (!canvasRef || !$sab) {
      vizInst?.destroy();
    } else {
      vizInst = new MixerLevelsViz(canvasRef, 1);
      vizInst.setAudioThreadBuffer($sab);
    }
  }

  onDestroy(() => void vizInst?.destroy());
</script>

<div class="root">
  <SvelteControlPanel
    title="destination settings"
    {settings}
    width={500}
    state={controlPanelState}
    onChange={handleChange}
  />
  {#if $state.safetyLimiterEnabled && $sab}
    <canvas bind:this={canvasRef} style="width: 500px; background: black; margin-top: -60px" />
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
