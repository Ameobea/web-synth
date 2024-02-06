<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { Oscilloscope } from 'src/visualizations/Oscilloscope/Oscilloscope';
  import {
    type OscilloscopeUIState,
    OscilloscopeWindowType,
  } from 'src/visualizations/Oscilloscope/types';

  export let inst: Oscilloscope;
  export let state: Writable<OscilloscopeUIState>;

  let settings: ControlPanelSetting[] = [];
  $: {
    const {
      min: minWindowLength,
      max: maxWindowLength,
      scale: windowScale,
      step: windowStep,
    } = (
      {
        [OscilloscopeWindowType.Seconds]: {
          min: 0.02,
          max: 10,
          scale: 'log',
        },
        [OscilloscopeWindowType.Beats]: {
          min: 0.25,
          max: 32,
          scale: 'log',
        },
        [OscilloscopeWindowType.Samples]: {
          min: 100,
          max: 44_100 * 2,
          scale: 'log',
        },
        [OscilloscopeWindowType.Wavelengths]: {
          min: 1,
          max: 16,
          scale: undefined,
          step: 1,
        },
      } as Record<
        OscilloscopeWindowType,
        { min: number; max: number; scale: 'log' | undefined; step: number | undefined }
      >
    )[$state.window.type];

    const newSettings: ControlPanelSetting[] = [
      {
        label: 'window mode',
        type: 'select',
        options: ['seconds', 'beats', 'samples', 'wavelengths'],
      },
      {
        label: 'window length',
        type: 'range',
        min: minWindowLength,
        max: maxWindowLength,
        scale: windowScale,
        step: windowStep,
      },
      { label: 'freeze', type: 'checkbox' },
      { label: 'frame by frame', type: 'checkbox' },
    ];
    if ($state.window.type === OscilloscopeWindowType.Wavelengths) {
      newSettings.push({ label: 'snap to midi', type: 'checkbox' });
    }

    settings = newSettings;
  }

  $: controlPanelState = {
    'window mode': (() => {
      const mode = (
        {
          [OscilloscopeWindowType.Seconds]: 'seconds',
          [OscilloscopeWindowType.Beats]: 'beats',
          [OscilloscopeWindowType.Samples]: 'samples',
          [OscilloscopeWindowType.Wavelengths]: 'wavelengths',
        } as Record<OscilloscopeWindowType, string>
      )[$state.window.type];
      if (mode === undefined) {
        throw new Error(`Invalid window type: ${$state.window.type}`);
      }
      return mode;
    })(),
    'window length': $state.window.value,
    freeze: $state.frozen,
    'frame by frame': $state.frameByFrame,
    'snap to midi': $state.snapF0ToMIDI,
  };

  const handleChange = (key: string, value: any, _state: Record<string, any>) => {
    switch (key) {
      case 'window mode':
        const newWindowType = (
          {
            seconds: OscilloscopeWindowType.Seconds,
            beats: OscilloscopeWindowType.Beats,
            samples: OscilloscopeWindowType.Samples,
            wavelengths: OscilloscopeWindowType.Wavelengths,
          } as Record<string, OscilloscopeWindowType>
        )[value];
        if (newWindowType === undefined) {
          throw new Error(`Invalid window type: ${value}`);
        }

        state.update(state => {
          if (state.window.type === newWindowType) {
            return state;
          }
          inst.setWindow(newWindowType, state.lastValueByWindowType[newWindowType]);

          const frameByFrame =
            newWindowType === OscilloscopeWindowType.Wavelengths ? false : state.frameByFrame;
          inst.setFrameByFrame(frameByFrame);

          return {
            ...state,
            window: {
              ...state.window,
              type: newWindowType,
              value: state.lastValueByWindowType[newWindowType],
            },
            frameByFrame,
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
      case 'snap to midi':
        inst.setSnapF0ToMIDI(value);
        state.update(state => {
          if (state.snapF0ToMIDI === value) {
            return state;
          }

          return {
            ...state,
            snapF0ToMIDI: value,
          };
        });
        break;
      default:
        console.warn(`Unhandled change in \`OscilloscopeControls\`: ${key} = ${value}`);
    }
  };
</script>

<div class="root">
  <SvelteControlPanel {settings} onChange={handleChange} state={controlPanelState} width={500} />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }
</style>
