<script lang="ts">
  import { renderSvelteModalWithControls } from 'src/controls/Modal';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { SampleDescriptor } from 'src/sampleLibrary';
  import ConfirmReset from 'src/sampler/SamplerUI/ConfirmReset.svelte';

  export let activeSample: { descriptor: SampleDescriptor; data?: AudioBuffer } | null;
  export let clearActiveSample: () => void;
</script>

<div class="root">
  <p>Active sample: {activeSample?.descriptor.name ?? 'none'}</p>
  <SvelteControlPanel
    settings={[
      {
        type: 'button',
        action: async () => {
          try {
            await renderSvelteModalWithControls(ConfirmReset, true);
            clearActiveSample();
          } catch (_err) {
            // cancelled
          }
        },
        label: 'reset',
      },
    ]}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
