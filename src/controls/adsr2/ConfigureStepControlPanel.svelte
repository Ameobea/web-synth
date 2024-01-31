<script lang="ts" context="module">
  import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';

  interface LocalState {
    x: number;
    y: number;
  }
</script>

<script lang="ts">
  import { filterNils, samplesToMs } from 'src/util';

  export let top: number;
  export let left: number;
  export let step: { x: number; y: number };
  export let outputRange: readonly [number, number];
  export let length:
    | { type: 'samples'; value: number }
    | { type: 'beats'; value: number }
    | { type: 'ms'; value: number };
  export let onSubmit: (newStep: { x: number; y: number }) => void;
  export let onCancel: () => void;
  export let enableY = true;

  const { normalizedToLocalX, localToNormalizedX } = (() => {
    switch (length.type) {
      case 'samples':
        const ms = samplesToMs(length.value);
        return {
          normalizedToLocalX: (x: number) => x * ms,
          localToNormalizedX: (x: number) => x / ms,
        };
      case 'beats':
        return {
          normalizedToLocalX: (x: number) => x * length.value,
          localToNormalizedX: (x: number) => x / length.value,
        };
      case 'ms':
        return {
          normalizedToLocalX: (x: number) => x * length.value,
          localToNormalizedX: (x: number) => x / length.value,
        };
      default:
        throw new Error('Unknown length type: ' + (length as any).type);
    }
  })();
  const { normalizedToLocalY, localToNormalizedY } = {
    normalizedToLocalY: (y: number) => {
      const [min, max] = outputRange;
      return y * (max - min) + min;
    },
    localToNormalizedY: (y: number) => {
      const [min, max] = outputRange;
      return (y - min) / (max - min);
    },
  };

  const settings: ControlPanelSetting[] = filterNils([
    { type: 'range', label: 'x', min: 0, max: normalizedToLocalX(1) },
    enableY ? { type: 'range', label: 'y', min: 0, max: normalizedToLocalY(1) } : null,
    { type: 'button', label: 'cancel', action: onCancel },
    {
      type: 'button',
      label: 'submit',
      action: () => {
        const newStep = {
          x: localToNormalizedX(state.x),
          y: localToNormalizedY(state.y),
        };
        onSubmit(newStep);
      },
    },
  ]);

  let state: LocalState = {
    x: normalizedToLocalX(step.x),
    y: normalizedToLocalY(step.y),
  };

  const handleChange = (_key: string, _val: any, newState: any) => {
    state = newState;
  };
</script>

<div class="adsr2-configure-step-control-panel" style="top:{top}px; left:{left}px;">
  <SvelteControlPanel
    {settings}
    {state}
    onChange={handleChange}
    theme={{ background1: '#141414' }}
  />
</div>

<style lang="css">
  .adsr2-configure-step-control-panel {
    display: flex;
    flex-direction: column;
    transform: scale(0.8);
    transform-origin: top left;
    position: fixed;
    border: 1px solid #888;
    box-sizing: border-box;
    margin-bottom: -1px;
  }

  :global(.adsr2-configure-step-control-panel .control-panel > .container > :first-child) {
    width: 10% !important;
  }

  :global(.adsr2-configure-step-control-panel .control-panel > .container > :nth-child(3)) {
    width: 37% !important;
  }
</style>
