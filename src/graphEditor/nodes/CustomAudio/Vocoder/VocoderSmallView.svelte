<script lang="ts" context="module">
  const settings: ControlPanelSetting[] = [
    { label: 'carrier gain (dB)', type: 'range', min: -40, max: 50 },
    { label: 'modulator gain (dB)', type: 'range', min: -40, max: 50 },
    { label: 'post gain (dB)', type: 'range', min: -40, max: 50 },
  ];
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { VocoderState } from 'src/graphEditor/nodes/CustomAudio/Vocoder/VocoderNode';

  export let store: Writable<VocoderState>;
  $: state = {
    'carrier gain (dB)': $store.carrierGainDb,
    'modulator gain (dB)': $store.modulatorGainDb,
    'post gain (dB)': $store.postGainDb,
  };

  const handleChange = (key: string, value: number, _newState: Record<string, any>) => {
    store.update(state => {
      switch (key) {
        case 'carrier gain (dB)':
          state.carrierGainDb = value;
          break;
        case 'modulator gain (dB)':
          state.modulatorGainDb = value;
          break;
        case 'post gain (dB)':
          state.postGainDb = value;
          break;
        default:
          console.warn('Unhandled key in vocoder small view: ', key);
      }
      return state;
    });
  };
</script>

<div class="root">
  <SvelteControlPanel {settings} {state} onChange={handleChange} style={{ width: '100%' }} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
</style>
