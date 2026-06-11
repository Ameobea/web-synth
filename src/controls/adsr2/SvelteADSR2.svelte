<script lang="ts">
  import type { ADSR2Instance } from 'src/controls/adsr2/adsr2';
  import type { ADSRWithOutputRange } from 'src/controls/adsr2/ControlPanelADSR2';
  import ReactShim from 'src/misc/ReactShim.svelte';

  interface Props {
    width: number | undefined;
    height: number | undefined;
    initialState: ADSRWithOutputRange;
    onChange: (newState: ADSRWithOutputRange) => void;
    vcId: string | undefined;
    debugName: string | undefined;
    disableControlPanel: boolean | undefined;
    instanceCb: ((instance: ADSR2Instance) => void) | undefined;
    enableInfiniteMode?: boolean | undefined;
    disablePhaseVisualization?: boolean | undefined;
    setFrozenOutputValue: ((frozenOutputValue: number) => void) | undefined;
    beatsPerMeasure?: number | undefined;
  }

  let {
    width,
    height,
    initialState,
    onChange,
    vcId,
    debugName,
    disableControlPanel,
    instanceCb,
    enableInfiniteMode = false,
    disablePhaseVisualization = false,
    setFrozenOutputValue,
    beatsPerMeasure = undefined
  }: Props = $props();

  const ADSR2Promise = import('src/controls/adsr2/adsr2').then(m => m.default);
</script>

{#await ADSR2Promise then ADSR2}
  <ReactShim
    Component={ADSR2}
    props={{
      width,
      height,
      initialState,
      onChange,
      vcId,
      debugName,
      disableControlPanel,
      instanceCb,
      enableInfiniteMode,
      disablePhaseVisualization,
      setFrozenOutputValue,
      beatsPerMeasure,
    }}
  />
{/await}
