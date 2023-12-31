<script lang="ts" generics="T extends Record<string, any>">
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { onDestroy } from 'svelte';

  export let Component: React.FC<T> | React.ComponentClass<T>;
  export let props: T;

  let container: HTMLDivElement | null = null;
  $: root = container ? createRoot(container) : null;
  $: root?.render(React.createElement(Component, props));

  onDestroy(() => root?.unmount());
</script>

<div class="root" bind:this={container} style={$$props.__style} />
