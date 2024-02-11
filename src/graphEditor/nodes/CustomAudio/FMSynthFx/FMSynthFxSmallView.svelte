<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
  import ConfigureEffects from 'src/fmSynth/ConfigureEffects.svelte';
  import type { AdsrParams } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
  import type { FMSynthFxState } from 'src/graphEditor/nodes/CustomAudio/FMSynthFx/FMSynthFxNode';
  import type { Effect } from 'src/fmSynth/Effect';

  export let store: Writable<FMSynthFxState>;
  export let onChange: (ix: number, newState: Partial<Effect> | null) => void;
  export let commitAll: () => void;

  let state: (Effect | null)[] = $store.effects;
  $: state = $store.effects;

  const setOperatorEffects = (newFx: (Effect | null)[]) => {
    store.set({ effects: newFx });
    commitAll();
  };
  let adsrs: AdsrParams[] = []; // TODO
  let onAdsrChange: AdsrChangeHandler = (adsrIx: number, newParams: AdsrParams) => {
    // TODO
  };
</script>

<div class="root">
  <ConfigureEffects
    {state}
    {onChange}
    operatorIx={null}
    vcId={undefined}
    {setOperatorEffects}
    {adsrs}
    {onAdsrChange}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
