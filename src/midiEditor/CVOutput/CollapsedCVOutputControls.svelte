<script lang="ts">
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';
  import SvelteDragHandle from 'src/midiEditor/SvelteDragHandle.svelte';

  interface Props {
    name: string;
    expand: () => void;
    deleteOutput: () => void;
    setName: (name: string) => void;
    activateDrag: () => void;
  }

  let {
    name,
    expand,
    deleteOutput,
    setName,
    activateDrag
  }: Props = $props();
</script>

<div
  class="collapsed-cv-output-controls"
  onclick={expand}
  tabindex="0"
  onkeydown={e => e.key === 'Enter' && expand()}
  aria-label="Expand"
  role="button"
>
  › <SvelteDragHandle
    {activateDrag}
    style={{ zIndex: 2, top: 0, left: 28, position: 'absolute' }}
  />
  <EditableInstanceName left={60} {name} {setName} />
  <button class="delete-cv-output-button" onclick={deleteOutput}>✕</button>
</div>
