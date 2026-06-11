<script lang="ts" generics="T extends Record<string, any>">
  import type React from 'react';
  import type { createRoot, Root } from 'react-dom/client';
  import { onDestroy } from 'svelte';

  interface Props {
    Component: React.FC<T> | React.ComponentClass<T>;
    props: T;
    __style?: string;
  }

  let { Component, props, __style }: Props = $props();

  let ReactMod: typeof React | null = $state(null);
  let createRootFn: typeof createRoot | null = $state(null);
  void Promise.all([import('react'), import('react-dom/client')]).then(([react, reactDom]) => {
    ReactMod = react.default;
    createRootFn = reactDom.createRoot;
  });

  let container: HTMLDivElement | null = $state(null);
  let root: Root | null = $state(null);
  $effect(() => {
    if (container && ReactMod && createRootFn && !root) {
      root = createRootFn(container);
    }
  });
  $effect(() => {
    root?.render(ReactMod!.createElement(Component, props));
  });

  onDestroy(() => root?.unmount());
</script>

<div class="root" bind:this={container} style={__style}></div>
