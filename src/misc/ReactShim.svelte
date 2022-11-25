<script lang="ts">
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { onDestroy } from 'svelte';

  export let Component: React.Component;
  export let props = {};

  let container: HTMLDivElement | null = null;
  $: root = container ? createRoot(container) : null;
  $: root?.render(React.createElement(Component, props));

  onDestroy(() => root?.unmount());
</script>

<div class="root" bind:this={container} style={$$props.__style} />
