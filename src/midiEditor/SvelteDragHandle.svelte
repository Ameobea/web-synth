<script lang="ts">
  import type React from 'react';

  import ReactShim from 'src/misc/ReactShim.svelte';
  import { DragHandle } from './DnD';

  export let activateDrag: () => void;
  export let style: React.CSSProperties | undefined = undefined;
</script>

<ReactShim Component={DragHandle} props={{ activateDrag, style }} />
