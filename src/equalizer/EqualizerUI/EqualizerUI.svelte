<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { EQ_AXIS_MARGIN } from 'src/equalizer/conf';
  import type { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
  import EqHandle from 'src/equalizer/EqualizerUI/EqHandle.svelte';
  import EqualizerBackground from 'src/equalizer/EqualizerUI/EqualizerBackground.svelte';

  export let inst: EqualizerInstance;
  $: stateStore = inst.state;
  $: state = $stateStore;
  $: automatedParamsStore = inst.automatedParams;
  $: automatedParams = $automatedParamsStore;
  $: automationValsSABStore = inst.automationValsSAB;
  $: automationValsSAB = $automationValsSABStore;
  $: uiStateStore = inst.uiState;
  $: eqUIHidden = $uiStateStore.hidden;

  let container: HTMLDivElement;
  let containerWidth: number = 0;
  let containerHeight: number = 0;

  $: stageWidth = containerWidth - EQ_AXIS_MARGIN.left - EQ_AXIS_MARGIN.right;
  $: stageHeight = containerHeight - EQ_AXIS_MARGIN.top - EQ_AXIS_MARGIN.bottom;

  let resizeObs: ResizeObserver;
  onMount(() => {
    resizeObs = new ResizeObserver(entries => {
      containerWidth = entries[0].contentRect.width;
      containerHeight = entries[0].contentRect.height;
      setTimeout(() => inst.maybeComputeAndPlotResponse());
    });
    resizeObs.observe(container);
  });

  onDestroy(() => resizeObs.disconnect());

  $: automatedParamsByBand = (() => {
    const automatedParamsByBand: { freq: number | null; gain: number | null; q: number | null }[] =
      state.bands.map(() => ({
        freq: null,
        gain: null,
        q: null,
      }));
    for (
      let automationSlotIx = 0;
      automationSlotIx < automatedParams.length;
      automationSlotIx += 1
    ) {
      const automationSlot = automatedParams[automationSlotIx];
      if (!automationSlot) {
        continue;
      }

      const { bandIx, param } = automationSlot;
      automatedParamsByBand[bandIx][param] = automationSlotIx;
    }

    return automatedParamsByBand;
  })();
</script>

<div class="root" bind:this={container}>
  <EqualizerBackground {inst} {containerWidth} {containerHeight} {stageWidth} {stageHeight} />
  <div class="handles" style={`top: ${EQ_AXIS_MARGIN.top}px; left: ${EQ_AXIS_MARGIN.left}px;`}>
    {#each state.bands as band, bandIx}
      <EqHandle
        {band}
        {bandIx}
        isActive={state.activeBandIx === bandIx}
        onClick={() => inst.state.update(state => ({ ...state, activeBandIx: bandIx }))}
        onChange={newBand => inst.setBand(bandIx, newBand)}
        {stageHeight}
        {stageWidth}
        automatedParams={automatedParamsByBand[bandIx]}
        {automationValsSAB}
        {eqUIHidden}
      />
    {/each}
  </div>
</div>

<style lang="css">
  .root {
    position: relative;
    display: flex;
    flex-direction: column;
    height: calc(100vh - 34px);
    width: calc(min(100%, 85vw));
    margin-left: auto;
    margin-right: auto;
    border: 1px solid #cccccc44;
  }

  .handles {
    position: absolute;
  }
</style>
