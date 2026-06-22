<script lang="ts">
  import { untrack } from 'svelte';
  import { get, writable, type Writable } from 'svelte/store';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import { filterNils } from 'src/util';

  interface Props {
    top: number;
    left: number;
    initialBeat: number;
    initialBpm: number;
    isBase: boolean;
    onCancel: () => void;
    onSubmit: (beat: number, bpm: number) => void;
    onDelete: (() => void) | null;
  }

  let { top, left, initialBeat, initialBpm, isBase, onCancel, onSubmit, onDelete }: Props = $props();

  interface LocalState {
    bpm: number;
    beat: string;
  }
  let state: Writable<LocalState> = writable({
    bpm: untrack(() => initialBpm),
    beat: untrack(() => `${initialBeat}`),
  });

  const handleSubmit = () => {
    const s = get(state);
    const beat = isBase ? 0 : Number.parseFloat(s.beat);
    if (Number.isNaN(beat) || beat < 0 || Number.isNaN(s.bpm) || s.bpm <= 0) {
      return;
    }
    onSubmit(beat, s.bpm);
  };

  let settings: ControlPanelSetting[] = $derived(
    filterNils([
      { type: 'range', label: 'bpm', min: 1, max: 1200, step: 0.1 },
      isBase ? null : { type: 'text', label: 'beat' },
      !isBase && onDelete ? { type: 'button', label: 'delete', action: () => onDelete!() } : null,
      { type: 'button', label: 'cancel', action: () => onCancel() },
      { type: 'button', label: 'submit', action: () => handleSubmit() },
    ])
  );

  const handleChange = (key: string, val: any) => state.update(s => ({ ...s, [key]: val }));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tempo-flag-config"
  style="top:{top}px; left:{left}px;"
  oncontextmenu={e => e.preventDefault()}
>
  <SvelteControlPanel
    {settings}
    state={$state}
    onChange={handleChange}
    theme={{ background1: '#141414' }}
  />
</div>

<style lang="css">
  .tempo-flag-config {
    display: flex;
    flex-direction: column;
    transform: scale(0.8);
    transform-origin: top left;
    position: fixed;
    z-index: 1000;
    border: 1px solid #888;
    box-sizing: border-box;
  }
</style>
