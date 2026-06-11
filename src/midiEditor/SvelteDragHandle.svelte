<script lang="ts">
  import type React from 'react';

  import ReactShim from 'src/misc/ReactShim.svelte';
  import { DragHandle } from './DnD';

  interface Props {
    activateDrag: () => void;
    style?: React.CSSProperties | undefined;
  }

  let { activateDrag, style = undefined }: Props = $props();
</script>

<ReactShim Component={DragHandle} props={{ activateDrag, style }} />
