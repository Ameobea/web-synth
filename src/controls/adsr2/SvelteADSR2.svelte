<script lang="ts">
  import ADSR2, { type ADSR2Instance } from 'src/controls/adsr2/adsr2';
  import type { ADSRWithOutputRange } from 'src/controls/adsr2/ControlPanelADSR2';
  import ReactShim from 'src/misc/ReactShim.svelte';

  export let width: number | undefined;
  export let height: number | undefined;
  export let initialState: ADSRWithOutputRange;
  export let onChange: (newState: ADSRWithOutputRange) => void;
  export let vcId: string | undefined;
  export let debugName: string | undefined;
  export let disableControlPanel: boolean | undefined;
  export let instanceCb: ((instance: ADSR2Instance) => void) | undefined;
  export let enableInfiniteMode: boolean | undefined = false;
  export let disablePhaseVisualization: boolean | undefined = false;
  export let setFrozenOutputValue: ((frozenOutputValue: number) => void) | undefined;
  export let beatsPerMeasure: number | undefined = undefined;
</script>

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
