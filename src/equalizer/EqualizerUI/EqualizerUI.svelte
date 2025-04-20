<script lang="ts">
  import type { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
  import EqualizerBackground from 'src/equalizer/EqualizerUI/EqualizerBackground.svelte';

  export let inst: EqualizerInstance;
</script>

<div class="root">
  <EqualizerBackground {inst} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 34px);
    width: 100%;
  }
</style>
