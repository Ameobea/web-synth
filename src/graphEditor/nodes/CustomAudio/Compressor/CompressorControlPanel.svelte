<script lang="ts">
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { CompressorBandState } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';

  export let state: CompressorBandState;
  export let onChange: (newState: CompressorBandState) => void;
  export let ix: number;

  const MARGIN_TOP = 122;
  const VIZ_HEIGHT = 116;
  const PANEL_HEIGHT = 122 + 14 + 10;

  const handleChange = (_key: string, _val: number, newState: Record<string, any>) => {
    onChange({
      ...newState,
      top_ratio: newState.down_ratio,
      bottom_ratio: newState.up_ratio,
    } as CompressorBandState);
  };
</script>

<SvelteControlPanel
  settings={[
    { label: 'gain', type: 'range', min: 0, max: 2 },
    { label: 'attack_ms', type: 'range', min: 0.1, max: 500, scale: 'log' },
    { label: 'release_ms', type: 'range', min: 0.1, max: 500, scale: 'log' },
    { label: 'up_ratio', type: 'range', min: 0.1, max: 1, step: 0.001 },
    { label: 'down_ratio', type: 'range', min: 1, max: 500, scale: 'log' },
  ]}
  state={{ ...state, down_ratio: state.top_ratio, up_ratio: state.bottom_ratio }}
  onChange={handleChange}
  style={{
    width: '100%',
    height: 144,
    position: 'absolute',
    top: MARGIN_TOP + ix * PANEL_HEIGHT + (ix + 1) * VIZ_HEIGHT,
  }}
/>
