<script lang="ts">
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { CompressorBandState } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';

  export let state: CompressorBandState;
  export let onChange: (newState: CompressorBandState) => void;
  export let ix: number;

  const MARGIN_TOP = 152;
  const VIZ_HEIGHT = 116;
  const PANEL_HEIGHT = 174;

  const MIN_DB = -60;
  const toDb = (linear: number) =>
    linear > 0 ? Math.max(MIN_DB, 20 * Math.log10(linear)) : MIN_DB;
  const fromDb = (db: number) => (db <= MIN_DB ? 0 : Math.pow(10, db / 20));

  const handleChange = (_key: string, _val: number, newState: Record<string, any>) => {
    onChange({
      ...newState,
      top_ratio: newState.down_ratio,
      bottom_ratio: newState.up_ratio,
      pre_gain: fromDb(newState.pre_gain_db),
      post_gain: fromDb(newState.post_gain_db),
    } as CompressorBandState);
  };
</script>

<SvelteControlPanel
  settings={[
    { label: 'pre_gain_db', type: 'range', min: MIN_DB, max: 24 },
    { label: 'attack_ms', type: 'range', min: 0.1, max: 500, scale: 'log' },
    { label: 'release_ms', type: 'range', min: 0.1, max: 500, scale: 'log' },
    { label: 'up_ratio', type: 'range', min: 0.1, max: 1, step: 0.001 },
    { label: 'down_ratio', type: 'range', min: 1, max: 500, scale: 'log' },
    { label: 'post_gain_db', type: 'range', min: MIN_DB, max: 24 },
  ]}
  state={{
    ...state,
    down_ratio: state.top_ratio,
    up_ratio: state.bottom_ratio,
    pre_gain_db: toDb(state.pre_gain),
    post_gain_db: toDb(state.post_gain),
  }}
  onChange={handleChange}
  style={{
    width: '100%',
    height: 172,
    position: 'absolute',
    top: MARGIN_TOP + ix * PANEL_HEIGHT + (ix + 1) * VIZ_HEIGHT,
  }}
/>
