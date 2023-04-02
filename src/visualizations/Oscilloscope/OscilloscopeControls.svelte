<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteControlPanel, {
    ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';
  import {
    OscilloscopeUIState,
    OscilloscopeWindowType,
  } from 'src/visualizations/Oscilloscope/types';

  export let inst: Oscilloscope;
  export let state: Writable<OscilloscopeUIState>;

  let settings: ControlPanelSetting[] = [];
  $: {
    const { minWindowLength, maxWindowLength } = (
      {
        [OscilloscopeWindowType.Seconds]: { minWindowLength: 0.1, maxWindowLength: 10 },
        [OscilloscopeWindowType.Beats]: { minWindowLength: 1, maxWindowLength: 32 },
        [OscilloscopeWindowType.Samples]: { minWindowLength: 100, maxWindowLength: 44_100 * 2 },
      } as Record<OscilloscopeWindowType, { minWindowLength: number; maxWindowLength: number }>
    )[$state.window.type];

    const newSettings: ControlPanelSetting[] = [
      { label: 'window mode', type: 'select', options: ['seconds', 'beats', 'samples'] },
      {
        label: 'window length',
        type: 'range',
        min: minWindowLength,
        max: maxWindowLength,
        scale: 'log',
      },
      { label: 'freeze', type: 'checkbox' },
      { label: 'frame by frame', type: 'checkbox' },
    ];
    settings = newSettings;
  }

  $: controlPanelState = {
    'window mode': (
      {
        [OscilloscopeWindowType.Seconds]: 'seconds',
        [OscilloscopeWindowType.Beats]: 'beats',
        [OscilloscopeWindowType.Samples]: 'samples',
      } as Record<OscilloscopeWindowType, string>
    )[$state.window.type],
    'window length': $state.window.value,
    freeze: $state.frozen,
    'frame by frame': $state.frameByFrame,
  };

  const handleChange = (key: string, value: any, _state: Record<string, any>) => {
    switch (key) {
      case 'window mode':
        const newWindowType = (
          {
            seconds: OscilloscopeWindowType.Seconds,
            beats: OscilloscopeWindowType.Beats,
            samples: OscilloscopeWindowType.Samples,
          } as Record<string, OscilloscopeWindowType>
        )[value];
        if (!newWindowType) {
          throw new Error(`Invalid window type: ${value}`);
        }

        state.update(state => {
          if (state.window.type === newWindowType) {
            return state;
          }
          inst.setWindow(newWindowType, state.lastValueByWindowType[newWindowType]);

          return {
            ...state,
            window: {
              ...state.window,
              type: newWindowType,
              value: state.lastValueByWindowType[newWindowType],
            },
          };
        });
        break;
      case 'window length':
        state.update(state => {
          if (state.window.value === value) {
            return state;
          }
          inst.setWindow(state.window.type, value);

          return {
            ...state,
            window: {
              ...state.window,
              value,
            },
            lastValueByWindowType: {
              ...state.lastValueByWindowType,
              [state.window.type]: value,
            },
          };
        });
        break;
      case 'freeze':
        inst.setFrozen(value);
        state.update(state => {
          if (state.frozen === value) {
            return state;
          }

          return {
            ...state,
            frozen: value,
          };
        });
        break;
      case 'frame by frame':
        inst.setFrameByFrame(value);
        state.update(state => {
          if (state.frameByFrame === value) {
            return state;
          }

          return {
            ...state,
            frameByFrame: value,
          };
        });
        break;
      default:
        console.warn(`Unhandled change in \`OscilloscopeControls\`: ${key} = ${value}`);
    }
  };
</script>

<div class="root">
  <SvelteControlPanel {settings} onChange={handleChange} state={controlPanelState} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
