<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import { EqualizerFilterType, getValidParamsForFilterType } from 'src/equalizer/eqHelpers';
  import { type EqualizerBand } from 'src/equalizer/equalizer';
  import { mkBandParamDisplay } from './BandParamDisplay';

  export let band: EqualizerBand;
  export let bandIx: number;
  export let onChange: (newBand: EqualizerBand) => void;
  export let onDelete: () => void;
  export let automatedParams: { freq: number | null; gain: number | null; q: number | null };

  let settings: ControlPanelSetting[] = [];
  $: settings = (() => {
    const settings: ControlPanelSetting[] = [
      {
        type: 'select',
        options: {
          lowpass: `${EqualizerFilterType.Lowpass}`,
          highpass: `${EqualizerFilterType.Highpass}`,
          bandpass: `${EqualizerFilterType.Bandpass}`,
          notch: `${EqualizerFilterType.Notch}`,
          peak: `${EqualizerFilterType.Peak}`,
          lowshelf: `${EqualizerFilterType.Lowshelf}`,
          highshelf: `${EqualizerFilterType.Highshelf}`,
          allpass: `${EqualizerFilterType.Allpass}`,
        },
        label: 'filter type',
      },
    ];

    for (const paramKey of getValidParamsForFilterType(band.filterType)) {
      const isExternallyAutomated = automatedParams[paramKey] !== null;
      const paramSettings: ControlPanelSetting = {
        type: 'custom',
        label: paramKey,
        Comp: mkBandParamDisplay(isExternallyAutomated),
      };

      settings.push(paramSettings);
    }

    settings.push({
      type: 'button',
      label: 'delete band',
      action: onDelete,
    });

    return settings;
  })();

  $: state = {
    'filter type': `${band.filterType}`,
    freq: band.frequency,
    gain: band.gain,
    q: band.q,
  };

  const handleChange = (key: string, value: any) => {
    const newBand = { ...band };
    switch (key) {
      case 'filter type':
        newBand.filterType = +value;
        const validParamTypes = getValidParamsForFilterType(newBand.filterType);
        if (!validParamTypes.includes('gain')) {
          newBand.gain = 0;
        }
        break;
      case 'freq':
        newBand.frequency = value;
        break;
      case 'gain':
        newBand.gain = value;
        break;
      case 'q':
        newBand.q = value;
        break;
      default:
        console.warn(`Unknown setting: ${key}`);
        return;
    }

    onChange(newBand);
  };
</script>

<div class="root">
  <SvelteControlPanel
    {settings}
    {state}
    onChange={handleChange}
    width={500}
    title={`Band ${bandIx + 1}`}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
