<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { EQ_AXIS_MARGIN } from 'src/equalizer/conf';
  import type { EqualizerInstance } from 'src/equalizer/EqualizerInstance';
  import EqHandle from 'src/equalizer/EqualizerUI/EqHandle.svelte';
  import EqualizerBackground from 'src/equalizer/EqualizerUI/EqualizerBackground.svelte';
  import ConfigureBand from 'src/equalizer/EqualizerUI/ConfigureBand.svelte';

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
  let containerWidth: number = 100;
  let containerHeight: number = 100;

  $: stageWidth = containerWidth - EQ_AXIS_MARGIN.left - EQ_AXIS_MARGIN.right;
  $: stageHeight = containerHeight - EQ_AXIS_MARGIN.top - EQ_AXIS_MARGIN.bottom;

  let resizeObs: ResizeObserver;
  onMount(() => {
    resizeObs = new ResizeObserver(entries => {
      // reported width goes to 0 when the element is not visible.  This causes issues when propagating
      // to the line spectrogram, so we ignore those cases.  All the vizs should get paused when the
      // eq is hidden anyway.
      if (entries[0].contentRect.width <= 0 || entries[0].contentRect.height <= 0) {
        return;
      }

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

<div class="root">
  <div class="viz" bind:this={container}>
    <EqualizerBackground {inst} {containerWidth} {containerHeight} {stageWidth} {stageHeight} />
    <div class="handles" style={`top: ${EQ_AXIS_MARGIN.top}px; left: ${EQ_AXIS_MARGIN.left}px;`}>
      {#each state.bands as band, bandIx}
        <EqHandle
          {band}
          {bandIx}
          isActive={state.activeBandIx === bandIx}
          setActive={() => {
            if (inst.state.current.activeBandIx === bandIx) {
              return;
            }

            inst.state.update(state => ({ ...state, activeBandIx: bandIx }));
          }}
          onChange={newBand => inst.setBand(bandIx, newBand)}
          {stageHeight}
          {stageWidth}
          automatedParams={automatedParamsByBand[bandIx]}
          {automationValsSAB}
          {eqUIHidden}
          animateAutomatedParams={state.animateAutomatedParams ?? false}
        />
      {/each}
    </div>
  </div>
  <div class="configure-band-wrapper">
    {#if typeof state.activeBandIx === 'number'}
      <ConfigureBand
        band={state.bands[state.activeBandIx]}
        bandIx={state.activeBandIx}
        onChange={newBand => {
          if (typeof state.activeBandIx === 'number') {
            inst.setBand(state.activeBandIx, newBand);
          }
        }}
        onDelete={() => {
          if (typeof state.activeBandIx === 'number') {
            inst.deleteBand(state.activeBandIx);
          }
        }}
        automatedParams={automatedParamsByBand[state.activeBandIx]}
        isBypassed={state.isBypassed ?? false}
        setIsBypassed={isBypassed => inst.setBypassed(isBypassed)}
        reset={() => inst.reset()}
        animateAutomatedParams={state.animateAutomatedParams ?? false}
        setAnimateAutomatedParams={animateAutomatedParams =>
          inst.state.update(state => ({ ...state, animateAutomatedParams }))}
      />
    {/if}
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: row;
    width: 100%;
  }

  .viz {
    position: relative;
    display: flex;
    flex-direction: column;
    height: calc(100vh - 34px);
    width: calc(max(min(100%, 100vw - 500px), 100px));
    margin-left: auto;
    margin-right: auto;
    border: 1px solid #cccccc44;
  }

  .handles {
    position: absolute;
  }
</style>
