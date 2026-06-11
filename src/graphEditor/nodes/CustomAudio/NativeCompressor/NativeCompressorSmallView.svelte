<script lang="ts" module>
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

  interface Props {
    node: ForeignNode<DynamicsCompressorNode>;
  }

  let { node = $bindable() }: Props = $props();

  let cpState: State = $state(node.serialize() as State);

  const handleChange = (key: string, val: number) => {
    switch (key) {
      case 'threshold (db)':
        cpState.threshold = val;
        node.paramOverrides.threshold.override.offset.value = val;
        break;
      case 'knee (db)':
        cpState.knee = val;
        node.paramOverrides.knee.override.offset.value = val;
        break;
      case 'ratio':
        cpState.ratio = val;
        node.paramOverrides.ratio.override.offset.value = val;
        break;
      case 'attack (ms)':
        cpState.attack = val / 1000;
        node.paramOverrides.attack.override.offset.value = val / 1000;
        break;
      case 'release (ms)':
        cpState.release = val / 1000;
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
    'threshold (db)': cpState.threshold,
    'knee (db)': cpState.knee,
    ratio: cpState.ratio,
    'attack (ms)': cpState.attack * 1000,
    'release (ms)': cpState.release * 1000,
  }}
  onChange={handleChange}
  style={{ width: 500 }}
/>
