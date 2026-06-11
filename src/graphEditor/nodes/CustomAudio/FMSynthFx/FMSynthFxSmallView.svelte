<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { AdsrChangeHandler } from 'src/fmSynth/ConfigureEffects';
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

  const ConfigureEffectsPromise = import('src/fmSynth/ConfigureEffects.svelte').then(
    m => m.default
  );
</script>

<div class="root">
  {#await ConfigureEffectsPromise then ConfigureEffects}
    <svelte:component
      this={ConfigureEffects}
      {state}
      {onChange}
      operatorIx={null}
      vcId={undefined}
      {setOperatorEffects}
      {adsrs}
      {onAdsrChange}
    />
  {/await}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
