<script lang="ts">
  import type { ControlPanelSetting } from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import type { SmoothNode } from './SmoothNode';
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';

  interface Props {
    node: SmoothNode;
  }

  let { node }: Props = $props();

  const settings: ControlPanelSetting[] = [
    { label: 'filter coefficient', type: 'range', min: 0.9, max: 0.9999, scale: 'log' },
  ];

  const handleChange = (key: string, value: any) => {
    switch (key) {
      case 'filter coefficient':
        node.setFilterCoefficient(value);
        break;
      default:
        console.error(`Unhandled key in \`SmoothSmallView\`: ${key}`);
    }
  };
  let stateStore = $derived(node.state);
  let nodeState = $derived($stateStore);

  let cpState = $derived({ 'filter coefficient': nodeState.filterCoefficient });
</script>

<div class="root">
  <SvelteControlPanel {settings} state={cpState} onChange={handleChange} width={500} />
  <p>Applies a one-pole lowpass filter to the input signal.</p>
  <p>
    This is very useful for things like effect parameters to avoid clicksand other audio artifacts
    when input parameters are changed abruptly using UI sliders or similar.
  </p>
  <p><code>y = x[i-1] * coefficient + x[i] * (1 - coefficient)</code></p>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }

  p {
    font-size: 14px;
    padding: 4px;
    margin-top: 2px;
    margin-bottom: 4px;
  }
</style>
