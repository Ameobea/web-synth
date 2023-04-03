<script lang="ts">
  import type { SignalAnalyzerInst } from 'src/signalAnalyzer/SignalAnalyzerInst';
  import LineSpectrogramUI from 'src/visualizations/LineSpectrogram/LineSpectrogramUI.svelte';
  import OscilloscopeUI from 'src/visualizations/Oscilloscope/OscilloscopeUI.svelte';

  export let inst: SignalAnalyzerInst;
</script>

<div class="root">
  <LineSpectrogramUI inst={inst.lineSpectrogram} />
  <OscilloscopeUI inst={inst.oscilloscope} uiState={inst.oscilloscopeUIState} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
