<script lang="ts">
  import { createVcIsHiddenStore } from 'src/ViewContextManager/VcHideStatusRegistry';
  import WelcomePage from './WelcomePage.svelte';

  export let vcId: string;

  $: isHiddenStore = createVcIsHiddenStore(vcId);
</script>

{#if !$isHiddenStore}
  <WelcomePage />
{/if}
