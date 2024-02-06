<script lang="ts" context="module">
  import type { Writable } from 'svelte/store';

  import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { LineSpectrogramUIState } from 'src/visualizations/LineSpectrogram/types';

  const settings: ControlPanelSetting[] = [
    { type: 'interval', label: 'min/max dB', min: -100, max: 10 },
    { type: 'range', label: 'smoothing factor', min: 0, max: 0.99, step: 0.01 },
  ];
</script>

<script lang="ts">
  export let store: Writable<LineSpectrogramUIState>;
  export let analyserNode: AnalyserNode;

  $: controlPanelState = {
    'min/max dB': $store.rangeDb,
    'smoothing factor': $store.smoothingCoeff,
  };

  const handleChange = (key: string, value: any) => {
    store.update(state => {
      const newState = { ...state };
      switch (key) {
        case 'min/max dB':
          newState.rangeDb = value;
          analyserNode.minDecibels = value[0];
          analyserNode.maxDecibels = value[1];
          break;
        case 'smoothing factor':
          newState.smoothingCoeff = value;
          analyserNode.smoothingTimeConstant = value;
          break;
      }
      return newState;
    });
  };
</script>

<SvelteControlPanel
  {settings}
  state={controlPanelState}
  onChange={handleChange}
  style={{ width: 'calc(25vw - 80px)', marginRight: 46 }}
/>
