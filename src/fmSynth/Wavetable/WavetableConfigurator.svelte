<script context="module" lang="ts">
  enum Route {
    BrowseWavetables,
    ImportWavetable,
    BuildWavetable,
  }
</script>

<script lang="ts">
  import SvelteControlPanel from 'src/controls/SvelteControlPanel/SvelteControlPanel.svelte';
  import BuildWavetable from 'src/fmSynth/Wavetable/BuildWavetable.svelte';

  export let onSubmit: (val: unknown) => void;
  export let onCancel: () => void;

  let route: Route = Route.BrowseWavetables;
</script>

<div class="root basic-modal">
  {#if route === Route.BrowseWavetables}
    <SvelteControlPanel
      settings={[
        {
          type: 'button',
          label: 'build wavetable',
          action: () => {
            route = Route.BuildWavetable;
          },
        },
      ]}
    />
  {:else if route === Route.ImportWavetable}
    <h1>Import Wavetable</h1>
    <p>TODO</p>
  {:else if route === Route.BuildWavetable}
    <BuildWavetable
      onSubmit={wavetable => {
        // TODO
      }}
      onCancel={() => {
        route = Route.BrowseWavetables;
      }}
    />
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    height: 100%;
    flex-direction: column;
    width: 90vw;
    height: 88vh;
    background-color: #222;
  }
</style>
