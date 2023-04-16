<script lang="ts">
  import SignalAnalyzerGlobalControls from 'src/signalAnalyzer/SignalAnalyzerGlobalControls.svelte';
  import type { SignalAnalyzerInst } from 'src/signalAnalyzer/SignalAnalyzerInst';
  import LineSpectrogramUI from 'src/visualizations/LineSpectrogram/LineSpectrogramUI.svelte';
  import OscilloscopeUI from 'src/visualizations/Oscilloscope/OscilloscopeUI.svelte';

  export let inst: SignalAnalyzerInst;
</script>

<div class="root">
  <div class="line-spectrogram-wrapper">
    <LineSpectrogramUI inst={inst.lineSpectrogram} store={inst.lineSpectrogram.store} />
    <SignalAnalyzerGlobalControls analyserNode={inst.input} store={inst.lineSpectrogram.store} />
  </div>
  <OscilloscopeUI inst={inst.oscilloscope} uiState={inst.oscilloscopeUIState} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }

  .line-spectrogram-wrapper {
    display: flex;
    flex-direction: row;
  }
</style>
