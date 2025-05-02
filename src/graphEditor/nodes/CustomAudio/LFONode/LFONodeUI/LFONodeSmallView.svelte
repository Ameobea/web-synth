<script lang="ts">
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import {
    OscillatorType,
    type LFOInstance,
  } from 'src/graphEditor/nodes/CustomAudio/LFONode/LFOInstance';
  import LfoPhaseViz from 'src/graphEditor/nodes/CustomAudio/LFONode/LFONodeUI/LFOPhaseViz.svelte';

  export let inst: LFOInstance;

  $: stateStore = inst.state;
  $: state = $stateStore;
  $: phaseSABStore = inst.phaseSAB;
  $: phaseSAB = $phaseSABStore;

  $: settings = (() => {
    const settings: ControlPanelSetting[] = [
      {
        type: 'select',
        label: 'waveform',
        options: {
          sine: OscillatorType.Sine,
          sawtooth: OscillatorType.Sawtooth,
          square: OscillatorType.Square,
          triangle: OscillatorType.Triangle,
        },
      },
      {
        type: 'range',
        label: 'frequency',
        min: 0.01,
        max: 1000,
        scale: 'log',
      },
      {
        type: 'range',
        label: 'start phase',
        min: 0,
        max: 1,
        step: 0.001,
      },
      {
        type: 'checkbox',
        label: 'reset phase on playback start',
      },
    ];

    if (state.oscillator.type === OscillatorType.Square) {
      settings.push({
        type: 'range',
        label: 'duty cycle',
        min: 0,
        max: 1,
        step: 0.01,
      });
    }

    return settings;
  })();

  $: controlPanelState = {
    waveform: state.oscillator.type,
    frequency: state.frequency,
    'start phase': state.phaseInit.startPhase,
    'reset phase on playback start': state.phaseInit.setPhaseOnPlaybackStart,
    'duty cycle':
      state.oscillator.type === OscillatorType.Square ? state.oscillator.dutyCycle : null,
  };

  const handleChange = (key: string, value: any) => {
    switch (key) {
      case 'waveform':
        inst.setOscillatorConfig({ ...state.oscillator, type: value });
        break;
      case 'frequency':
        inst.setManualFrequency(+value);
        break;
      case 'start phase':
        inst.setPhaseInitConfig({ ...state.phaseInit, startPhase: +value });
        break;
      case 'reset phase on playback start':
        inst.setPhaseInitConfig({ ...state.phaseInit, setPhaseOnPlaybackStart: !!value });
        break;
      case 'duty cycle':
        inst.setOscillatorConfig({
          ...state.oscillator,
          type: OscillatorType.Square,
          dutyCycle: +value,
        });
        break;
      default:
        console.error('Unknown key in LFO control panel:', key);
    }
  };
</script>

<div class="root">
  <SvelteControlPanel {settings} state={controlPanelState} onChange={handleChange} width={500} />
  {#if phaseSAB}
    <LfoPhaseViz {phaseSAB} />
  {/if}
  <i style="text-align: center; margin-top: 4px;">Outputs values from -1 to 1</i>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
