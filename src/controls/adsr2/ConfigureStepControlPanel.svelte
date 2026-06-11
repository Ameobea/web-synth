<script lang="ts" module>
  import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';

  interface LocalState {
    x: number;
    y: number;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { filterNils, samplesToMs } from 'src/util';

  interface Props {
    top: number;
    left: number;
    step: { x: number; y: number };
    outputRange: readonly [number, number];
    length:
    | { type: 'samples'; value: number }
    | { type: 'beats'; value: number }
    | { type: 'ms'; value: number };
    onSubmit: (newStep: { x: number; y: number }) => void;
    onCancel: () => void;
    enableY?: boolean;
  }

  let {
    top,
    left,
    step,
    outputRange,
    length,
    onSubmit,
    onCancel,
    enableY = true
  }: Props = $props();

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

  const settings: ControlPanelSetting[] = $derived(filterNils([
    { type: 'range', label: 'x', min: 0, max: normalizedToLocalX(1) },
    enableY ? { type: 'range', label: 'y', min: 0, max: normalizedToLocalY(1) } : null,
    { type: 'button', label: 'cancel', action: () => onCancel() },
    {
      type: 'button',
      label: 'submit',
      action: () => {
        const newStep = {
          x: localToNormalizedX(cpState.x),
          y: localToNormalizedY(cpState.y),
        };
        onSubmit(newStep);
      },
    },
  ]));

  let cpState: LocalState = $state({
    x: normalizedToLocalX(untrack(() => step.x)),
    y: normalizedToLocalY(untrack(() => step.y)),
  });

  const handleChange = (_key: string, _val: any, newState: any) => {
    cpState = newState;
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="adsr2-configure-step-control-panel"
  style="top:{top}px; left:{left}px;"
  oncontextmenu={e => e.preventDefault()}
>
  <SvelteControlPanel
    {settings}
    state={cpState}
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
