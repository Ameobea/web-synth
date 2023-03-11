<script lang="ts" context="module">
  const settings: ControlPanelSetting[] = [
    { label: 'pre gain', type: 'range', min: 0, max: 3, step: 0.0001 },
    { label: 'post gain', type: 'range', min: 0, max: 3, step: 0.0001 },
    { label: 'q', type: 'range', min: 0.3, max: 20, step: 0.001 },
    { label: 'normalized frequency', type: 'range', min: 0, max: 1, step: 0.0001 },
    { label: 'wet', type: 'range', min: 0, max: 1, step: 0.0001 },
    { label: 'dry', type: 'range', min: 0, max: 1, step: 0.0001 },
  ];

  const mapKey = (key: string) =>
    (({
      q: 'Q',
      'normalized frequency': 'normalizedFrequency',
      'pre gain': 'preGain',
      'post gain': 'postGain',
    }[key] as keyof MBDLDNodeBandState) || (key as keyof MBDLDNodeBandState));
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type {
    MBDLDNodeBandState,
    MBDLDNodeState,
  } from 'src/graphEditor/nodes/CustomAudio/MultibandDiodeLadderDistortion/MultibandDiodeLadderDistortionNode';

  export let store: Writable<MBDLDNodeState>;
  export let onChange: (
    band: 'low' | 'mid' | 'high',
    key: keyof MBDLDNodeBandState,
    val: number
  ) => void;

  $: lowBandState = {
    'pre gain': $store.low.preGain,
    'post gain': $store.low.postGain,
    q: $store.low.Q,
    'normalized frequency': $store.low.normalizedFrequency,
    wet: $store.low.wet,
    dry: $store.low.dry,
  };
  $: midBandState = {
    'pre gain': $store.mid.preGain,
    'post gain': $store.mid.postGain,
    q: $store.mid.Q,
    'normalized frequency': $store.mid.normalizedFrequency,
    wet: $store.mid.wet,
    dry: $store.mid.dry,
  };
  $: highBandState = {
    'pre gain': $store.high.preGain,
    'post gain': $store.high.postGain,
    q: $store.high.Q,
    'normalized frequency': $store.high.normalizedFrequency,
    wet: $store.high.wet,
    dry: $store.high.dry,
  };

  const handleLowBandChange = (key: string, val: number) => onChange('low', mapKey(key), val);
  const handleMidBandChange = (key: string, val: number) => onChange('mid', mapKey(key), val);
  const handleHighBandChange = (key: string, val: number) => onChange('high', mapKey(key), val);
</script>

<div class="root">
  <SvelteControlPanel
    title="low band"
    {settings}
    onChange={handleLowBandChange}
    state={lowBandState}
    width={500}
  />
  <SvelteControlPanel
    title="mid band"
    {settings}
    onChange={handleMidBandChange}
    state={midBandState}
    width={500}
  />
  <SvelteControlPanel
    title="high band"
    {settings}
    onChange={handleHighBandChange}
    state={highBandState}
    width={500}
  />

  <p>
    Multiband distortion implemented using simulated analog diode ladder filters. Driving signals
    into each band with higher Q factors creates some nice distortion.
    <br /><br />
    The underlying Faust code for the filter was implemented by Eric Tarr during the 2019 Embedded DSP
    With Faust Workshop.
  </p>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  p {
    padding-left: 8px;
    padding-right: 8px;
  }
</style>
