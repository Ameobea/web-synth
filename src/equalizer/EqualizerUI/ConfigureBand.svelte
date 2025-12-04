<script lang="ts">
  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import { EqualizerFilterType, getValidParamsForFilterType } from 'src/equalizer/eqHelpers';
  import { type EqualizerBand } from 'src/equalizer/equalizer';
  import { mkBandParamDisplay } from './BandParamDisplay';

  export let isBypassed: boolean;
  export let setIsBypassed: (isBypassed: boolean) => void;
  export let animateAutomatedParams: boolean;
  export let setAnimateAutomatedParams: (animate: boolean) => void;
  export let reset: () => void;
  export let band: EqualizerBand;
  export let bandIx: number;
  export let onChange: (newBand: EqualizerBand) => void;
  export let onDelete: () => void;
  export let automatedParams: { freq: number | null; gain: number | null; q: number | null };

  $: lowOrderFilterType = (() => {
    switch (band.filterType) {
      case EqualizerFilterType.Order4Lowpass:
      case EqualizerFilterType.Order8Lowpass:
      case EqualizerFilterType.Order16Lowpass:
        return EqualizerFilterType.Lowpass;
      case EqualizerFilterType.Order4Highpass:
      case EqualizerFilterType.Order8Highpass:
      case EqualizerFilterType.Order16Highpass:
        return EqualizerFilterType.Highpass;
      default:
        return band.filterType;
    }
  })();

  $: curFilterOrder = (() => {
    switch (band.filterType) {
      case EqualizerFilterType.Order4Lowpass:
      case EqualizerFilterType.Order4Highpass:
        return 4 as const;
      case EqualizerFilterType.Order8Lowpass:
      case EqualizerFilterType.Order8Highpass:
        return 8 as const;
      case EqualizerFilterType.Order16Lowpass:
      case EqualizerFilterType.Order16Highpass:
        return 16 as const;
      default:
        return 2 as const;
    }
  })();

  let settings: ControlPanelSetting[] = [];
  $: settings = (() => {
    const settings: ControlPanelSetting[] = [
      { type: 'checkbox', label: 'bypass' },
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
          dynabandpass: `${EqualizerFilterType.Dynabandpass}`,
        },
        label: 'filter type',
      },
    ];

    if (
      lowOrderFilterType === EqualizerFilterType.Lowpass ||
      lowOrderFilterType === EqualizerFilterType.Highpass
    ) {
      settings.push({
        type: 'select',
        options: {
          2: '2',
          4: '4',
          8: '8',
          16: '16',
        },
        label: 'filter order',
      });
    }

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
    bypass: isBypassed,
    'filter type': `${lowOrderFilterType}`,
    'filter order': `${curFilterOrder}`,
    freq: band.frequency,
    gain: band.gain,
    q: band.q,
  };

  const handleChange = (key: string, value: any) => {
    const newBand = { ...band };
    switch (key) {
      case 'bypass':
        setIsBypassed(value);
        return;
      case 'filter type':
        newBand.filterType = +value;
        switch (newBand.filterType) {
          case EqualizerFilterType.Lowpass:
            newBand.filterType = newBand.filterType = {
              2: EqualizerFilterType.Lowpass,
              4: EqualizerFilterType.Order4Lowpass,
              8: EqualizerFilterType.Order8Lowpass,
              16: EqualizerFilterType.Order16Lowpass,
            }[curFilterOrder];
            break;
          case EqualizerFilterType.Highpass:
            newBand.filterType = {
              2: EqualizerFilterType.Highpass,
              4: EqualizerFilterType.Order4Highpass,
              8: EqualizerFilterType.Order8Highpass,
              16: EqualizerFilterType.Order16Highpass,
            }[curFilterOrder];
            break;
          default:
          // pass
        }

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
      case 'filter order': {
        const newOrder = +value as 2 | 4 | 8 | 16;
        switch (lowOrderFilterType) {
          case EqualizerFilterType.Lowpass:
            newBand.filterType = {
              2: EqualizerFilterType.Lowpass,
              4: EqualizerFilterType.Order4Lowpass,
              8: EqualizerFilterType.Order8Lowpass,
              16: EqualizerFilterType.Order16Lowpass,
            }[newOrder];
            break;
          case EqualizerFilterType.Highpass:
            newBand.filterType = {
              2: EqualizerFilterType.Highpass,
              4: EqualizerFilterType.Order4Highpass,
              8: EqualizerFilterType.Order8Highpass,
              16: EqualizerFilterType.Order16Highpass,
            }[newOrder];
            break;
          default:
            console.error(
              'Should not be able to set filter order for this filter type:',
              lowOrderFilterType
            );
            return;
        }
        break;
      }
      default:
        console.warn(`Unknown setting: ${key}`);
        return;
    }

    onChange(newBand);
  };

  $: globalState = {
    bypass: isBypassed,
    'animate automated params': animateAutomatedParams,
  };

  const handleGlobalChange = (key: string, value: any) => {
    switch (key) {
      case 'bypass':
        setIsBypassed(value);
        break;
      case 'animate automated params':
        setAnimateAutomatedParams(value);
        break;
      default:
        console.warn(`Unknown setting: ${key}`);
    }
  };

  const globalSettings: ControlPanelSetting[] = [
    {
      type: 'checkbox',
      label: 'bypass',
    },
    {
      type: 'checkbox',
      label: 'animate automated params',
    },
    { type: 'button', label: 'reset', action: reset },
  ];
</script>

<div class="root">
  <SvelteControlPanel
    settings={globalSettings}
    state={globalState}
    onChange={handleGlobalChange}
    width={460}
  />
  <SvelteControlPanel
    {settings}
    {state}
    onChange={handleChange}
    width={460}
    title={`Band ${bandIx + 1}`}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    width: 500px;
  }
</style>
