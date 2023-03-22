<script lang="ts">
  import type { MIDIEditorInstance } from 'src/midiEditor';
  import { PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';

  export let parentInstance: MIDIEditorInstance;
  export let name: string;
  export let expand: () => void;
  export let deleteOutput: () => void;
</script>

<div
  class="collapsed-cv-output-controls"
  on:click={expand}
  tabindex="0"
  on:keydown={e => e.key === 'Enter' && expand()}
  aria-label="Expand"
  role="button"
>
  › <EditableInstanceName
    left={PIANO_KEYBOARD_WIDTH + 2}
    {name}
    setName={newName => parentInstance.uiManager.renameInstance(name, newName)}
  />
  <button class="delete-cv-output-button" on:click={deleteOutput}>✕</button>
</div>
