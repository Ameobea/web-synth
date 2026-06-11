<script lang="ts" module>
  const settings: ControlPanelSetting[] = [
    { type: 'range', min: 1, max: 1000, steps: 500, scale: 'log', label: 'window size ms' },
  ];
</script>

<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { LevelDetectorNodeState } from 'src/graphEditor/nodes/CustomAudio/LevelDetectorNode/LevelDetectorNode';
  import { msToSamples, samplesToMs } from 'src/util';
  import type { Writable } from 'svelte/store';

  interface Props {
    state: Writable<LevelDetectorNodeState>;
    detectedLevelSAB: Writable<Float32Array | null>;
    onChange: (newState: LevelDetectorNodeState) => void;
  }

  let { state: stateStore, detectedLevelSAB, onChange }: Props = $props();

  let detectedLevel: number | null = $state(null);
  let detectedLevelDb = $derived(Math.max(
    detectedLevel !== null ? 20 * Math.log10(detectedLevel) : -Infinity,
    -100
  ));

  $effect(() => {
    const sab = $detectedLevelSAB;
    if (!sab) {
      return;
    }
    const intervalHandle = setInterval(() => {
      detectedLevel = sab[0];
    }, 100);
    return () => clearInterval(intervalHandle);
  });

  let controlPanelState = $derived({ 'window size ms': samplesToMs($stateStore.windowSizeSamples) });

  const handleChange = (key: string, value: any) => {
    switch (key) {
      case 'window size ms':
        onChange({ ...$stateStore, windowSizeSamples: msToSamples(value) });
        break;
      default:
        console.error('Unhandled key in `LevelDetectorNodeSmallView`:', key);
    }
  };
</script>

<div class="root">
  <h2>RMS Level Detector</h2>
  <SvelteControlPanel
    {settings}
    state={controlPanelState}
    onChange={handleChange}
    style={{ width: '100%' }}
  />

  {#if detectedLevel !== null}
    <div style="text-align: center; font-size: 16px; margin-top: 8px;">
      Current detected RMS level:
      <br />
      <div class="detected-level-container">
        <span class="detected-level-display">{detectedLevel.toFixed(5)}</span>
        <span class="detected-level-display">{detectedLevelDb.toFixed(1)}dB</span>
      </div>
    </div>
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  h2 {
    text-align: center;
    font-size: 26px;
    font-weight: 600;
    margin: 4px 0;
    border-bottom: 1px solid #999;
  }

  .detected-level-container {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    gap: 20px;
    margin-top: 6px;
  }

  .detected-level-display {
    font-family: Hack, monospace;
    font-weight: 500;
    font-size: 20px;
    display: block;
    width: 100px;
  }
</style>
