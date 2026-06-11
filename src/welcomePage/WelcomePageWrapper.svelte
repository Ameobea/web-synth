<script lang="ts">
  import { createVcIsHiddenStore } from 'src/ViewContextManager/VcHideStatusRegistry';
  import WelcomePage from './WelcomePage.svelte';

  interface Props {
    vcId: string;
  }

  let { vcId }: Props = $props();

  let isHiddenStore = $derived(createVcIsHiddenStore(vcId));
</script>

{#if !$isHiddenStore}
  <WelcomePage />
{/if}
