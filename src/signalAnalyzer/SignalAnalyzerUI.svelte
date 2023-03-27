<script lang="ts">
  import type { SignalAnalyzerInst } from 'src/signalAnalyzer/SignalAnalyzerInst';
  import OscilloscopeUI from 'src/visualizations/Oscilloscope/OscilloscopeUI.svelte';

  export let inst: SignalAnalyzerInst;
</script>

<div class="root">
  <OscilloscopeUI inst={inst.oscilloscope} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
