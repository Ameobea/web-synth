<script lang="ts">
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import {
    BUILD_WAVETABLE_INST_WIDTH_PX,
    BuildWavetableInstance,
  } from 'src/fmSynth/Wavetable/BuildWavetableInstance';

  export let onSubmit: (val: unknown) => void;
  export let onCancel: () => void;

  const buildWavetableInstance = (canvas: HTMLCanvasElement) => {
    const inst = new BuildWavetableInstance(canvas);

    return { destroy: () => void inst.destroy() };
  };
</script>

<div class="root">
  <div class="content">
    <canvas
      style="width: ${BUILD_WAVETABLE_INST_WIDTH_PX}px; height: ${BUILD_WAVETABLE_INST_WIDTH_PX}px;"
      use:buildWavetableInstance
    />
  </div>
  <div class="bottom">
    <SvelteControlPanel
      style={{ height: 100 }}
      settings={[{ type: 'button', label: 'cancel', action: onCancel }]}
    />
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .content {
    display: flex;
    flex: 1;
  }

  .bottom {
    display: flex;
    flex: 0;
    align-items: flex-end;
  }
</style>
