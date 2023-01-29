<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { CVOutputUIState } from 'src/midiEditor/CVOutput/CVOutput';

  export let name: string;
  export let state: Writable<CVOutputUIState>;
  export let collapse: () => void;
  export let deleteOutput: () => void;
</script>

<div class="root cv-output-controls">
  <header
    on:click={collapse}
    tabindex="0"
    on:keydown={e => e.key === 'Enter' && collapse()}
    aria-label="Collapse"
    role="button"
  >
    ⌄ {name}
    <button class="delete-cv-output-button" on:click={deleteOutput}>×</button>
  </header>

  CONTENT WILL GO HERE
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: 240px;
  }
</style>
