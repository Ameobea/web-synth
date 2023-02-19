<script lang="ts" context="module">
  const settings: ControlPanelSetting[] = [
    { label: 'input', type: 'text' },
    { label: 'times', type: 'text' },
  ];
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteControlPanel, {
    type ControlPanelSetting,
  } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { MultiplyNodeState } from 'src/graphEditor/nodes/CustomAudio/MultiplyNode/MultiplyNode';

  export let store: Writable<MultiplyNodeState>;
  let localState = {
    input: `${$store.input}`,
    times: `${$store.times}`,
  };

  const handleChange = (
    key: keyof MultiplyNodeState,
    val: string,
    _state: Record<string, number>
  ) =>
    void store.update(state => {
      localState[key] = val;
      const parsedVal = parseFloat(val);
      if (isNaN(parsedVal)) {
        return state;
      }
      state[key] = parsedVal;
      return state;
    });
</script>

<div class="root">
  <SvelteControlPanel
    {settings}
    onChange={handleChange}
    state={localState}
    style={{ width: '100%' }}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
</style>
