<script lang="ts">
  import { SampleDescriptor } from 'src/sampleLibrary';
  import type { SamplerInstance } from 'src/sampler/SamplerInstance';
  import MainSamplerUI from 'src/sampler/SamplerUI/MainSamplerUI.svelte';
  import PickSample from 'src/sampler/SamplerUI/PickSample.svelte';

  export let inst: SamplerInstance;

  $: activeSampleStore = inst.activeSample;
  $: activeSample = $activeSampleStore;

  const onSamplePicked = (desc: SampleDescriptor | null) => inst.setSelectedSample(desc);
  const clearActiveSample = () => inst.setSelectedSample(null);
</script>

<div class="root">
  {#if !activeSample}
    <PickSample {onSamplePicked} />
  {:else}
    <MainSamplerUI {activeSample} {clearActiveSample} />
  {/if}
</div>

<style lang="css">
  .root {
    padding: 12px;
  }
</style>
