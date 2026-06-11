<script lang="ts" generics="T extends Record<string, any>">
  import type React from 'react';
  import type { createRoot, Root } from 'react-dom/client';
  import { onDestroy } from 'svelte';

  export let Component: React.FC<T> | React.ComponentClass<T>;
  export let props: T;

  let ReactMod: typeof React | null = null;
  let createRootFn: typeof createRoot | null = null;
  void Promise.all([import('react'), import('react-dom/client')]).then(([react, reactDom]) => {
    ReactMod = react.default;
    createRootFn = reactDom.createRoot;
  });

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  $: if (container && ReactMod && createRootFn && !root) {
    root = createRootFn(container);
  }
  $: root?.render(ReactMod!.createElement(Component, props));

  onDestroy(() => root?.unmount());
</script>

<div class="root" bind:this={container} style={$$props.__style} />
