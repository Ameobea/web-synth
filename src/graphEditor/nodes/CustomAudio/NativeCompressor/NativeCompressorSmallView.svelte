<script lang="ts" context="module">
  interface State {
    attack: number;
    knee: number;
    ratio: number;
    release: number;
    threshold: number;
  }

  const settings: ControlPanelSetting[] = [
    { type: 'range', label: 'threshold (db)', min: -100, max: 0 },
    { type: 'range', label: 'knee (db)', min: 0, max: 40 },
    { type: 'range', label: 'ratio', min: 1, max: 20 },
    { type: 'range', label: 'attack (ms)', min: 0, max: 1000 },
    { type: 'range', label: 'release (ms)', min: 0, max: 1000 },
  ];
</script>

<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio';

  export let node: ForeignNode<DynamicsCompressorNode>;

  let state: State = node.serialize() as State;

  const handleChange = (key: string, val: number) => {
    switch (key) {
      case 'threshold (db)':
        state.threshold = val;
        node.paramOverrides.threshold.override.offset.value = val;
        break;
      case 'knee (db)':
        state.knee = val;
        node.paramOverrides.knee.override.offset.value = val;
        break;
      case 'ratio':
        state.ratio = val;
        node.paramOverrides.ratio.override.offset.value = val;
        break;
      case 'attack (ms)':
        state.attack = val / 1000;
        node.paramOverrides.attack.override.offset.value = val / 1000;
        break;
      case 'release (ms)':
        state.release = val / 1000;
        node.paramOverrides.release.override.offset.value = val / 1000;
        break;
      default:
        console.error('Unknown key in native compressor small view: ', key);
    }
  };
</script>

<SvelteControlPanel
  {settings}
  state={{
    'threshold (db)': state.threshold,
    'knee (db)': state.knee,
    ratio: state.ratio,
    'attack (ms)': state.attack * 1000,
    'release (ms)': state.release * 1000,
  }}
  onChange={handleChange}
  style={{ width: 500 }}
/>
