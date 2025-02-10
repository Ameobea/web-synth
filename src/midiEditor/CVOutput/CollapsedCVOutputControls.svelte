<script lang="ts">
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';
  import SvelteDragHandle from 'src/midiEditor/SvelteDragHandle.svelte';

  export let name: string;
  export let expand: () => void;
  export let deleteOutput: () => void;
  export let setName: (name: string) => void;
  export let activateDrag: () => void;
</script>

<div
  class="collapsed-cv-output-controls"
  on:click={expand}
  tabindex="0"
  on:keydown={e => e.key === 'Enter' && expand()}
  aria-label="Expand"
  role="button"
>
  › <SvelteDragHandle
    {activateDrag}
    style={{ zIndex: 2, top: 0, left: 28, position: 'absolute' }}
  />
  <EditableInstanceName left={60} {name} {setName} />
  <button class="delete-cv-output-button" on:click={deleteOutput}>✕</button>
</div>
