<script lang="ts">
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';

  export let name: string;
  export let expand: () => void;
  export let deleteOutput: () => void;
  export let setName: (name: string) => void;
</script>

<div
  class="collapsed-cv-output-controls"
  on:click={expand}
  tabindex="0"
  on:keydown={e => e.key === 'Enter' && expand()}
  aria-label="Expand"
  role="button"
>
  › <EditableInstanceName left={24} {name} {setName} />
  <button class="delete-cv-output-button" on:click={deleteOutput}>✕</button>
</div>
