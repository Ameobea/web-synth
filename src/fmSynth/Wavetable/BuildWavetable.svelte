<script lang="ts" context="module">
  interface BuildWavetableState {
    isPlaying: boolean;
    volumeDb: number;
    frequency: number;
  }
</script>

<script lang="ts">
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import {
    BUILD_WAVETABLE_INST_WIDTH_PX,
    BuildWavetableInstance,
    BuildWavetableSliderMode,
  } from 'src/fmSynth/Wavetable/BuildWavetableInstance';

  export let onSubmit: (val: unknown) => void;
  export let onCancel: () => void;

  let sliderMode: BuildWavetableSliderMode = BuildWavetableSliderMode.Magnitude;
  let inst: BuildWavetableInstance | null = null;
  let state: BuildWavetableState = {
    isPlaying: false,
    volumeDb: -30,
    frequency: 180,
  };

  const buildWavetableInstance = (canvas: HTMLCanvasElement) => {
    const thisInst = new BuildWavetableInstance(canvas);
    thisInst.setSliderMode(sliderMode);
    thisInst.setVolumeDb(state.volumeDb);
    thisInst.setFrequency(state.frequency);
    inst = thisInst;

    return { destroy: () => void thisInst.destroy() };
  };

  const handleChange = (key: string, val: any, _state: Record<string, any>) => {
    switch (key) {
      case 'play':
        state.isPlaying = val;
        inst?.setIsPlaying(val);
        break;
      case 'volume db':
        state.volumeDb = val;
        inst?.setVolumeDb(val);
        break;
      case 'frequency':
        state.frequency = val;
        inst?.setFrequency(val);
        break;
      default:
        console.error('unhandled key', key);
    }
  };
</script>

<div class="root">
  <div class="content">
    <canvas
      style="width: ${BUILD_WAVETABLE_INST_WIDTH_PX}px; height: ${BUILD_WAVETABLE_INST_WIDTH_PX}px;"
      use:buildWavetableInstance
    />
  </div>
  <div class="bottom">
    <SvelteControlPanel
      style={{ height: 100, width: 500 }}
      state={{ play: state.isPlaying, 'volume db': state.volumeDb }}
      settings={[
        { type: 'checkbox', label: 'play' },
        { type: 'range', label: 'volume db', min: -60, max: 0 },
        {
          type: 'button',
          label: `toggle sliders to ${
            sliderMode === BuildWavetableSliderMode.Magnitude ? 'phase' : 'magnitude'
          }`,
          action: () => {
            sliderMode =
              sliderMode === BuildWavetableSliderMode.Magnitude
                ? BuildWavetableSliderMode.Phase
                : BuildWavetableSliderMode.Magnitude;
            inst?.setSliderMode(sliderMode);
          },
        },
        { type: 'button', label: 'cancel', action: onCancel },
      ]}
      onChange={handleChange}
    />
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .content {
    display: flex;
    flex: 1;
  }

  .bottom {
    display: flex;
    flex: 0;
    align-items: flex-end;
  }
</style>
