<script lang="ts">
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { CompressorBandState } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';

  export let state: CompressorBandState;
  export let onChange: (newState: CompressorBandState) => void;
  export let ix: number;

  const handleChange = (_key: string, _val: number, newState: CompressorBandState) =>
    onChange(newState);
</script>

<SvelteControlPanel
  settings={[
    { label: 'gain', type: 'range', min: 0, max: 2 },
    { label: 'attack_ms', type: 'range', min: 0.1, max: 500, scale: 'log' },
    { label: 'release_ms', type: 'range', min: 0.1, max: 500, scale: 'log' },
  ]}
  {state}
  onChange={handleChange}
  style={{ width: 500, height: 144, position: 'absolute', top: 100 + 100 - 3 + ix * (140 + 100) }}
/>
