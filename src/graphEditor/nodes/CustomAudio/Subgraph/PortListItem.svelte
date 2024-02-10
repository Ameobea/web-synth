<script lang="ts">
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';
  import type { MIDINode } from 'src/patchNetwork/midiNode';
  import { formatConnectableType, type ConnectableType } from 'src/patchNetwork/patchNetwork';

  export let port: {
    type: ConnectableType;
    node: AudioNode | MIDINode;
  };
  export let name: string;
  export let onDelete: () => void;
  export let onRename: (newName: string) => void;
</script>

<div class="root">
  <div class="delete-button">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div role="button" on:click={onDelete} tabindex="0">×</div>
  </div>
  <div class="port-name">
    <EditableInstanceName left={0} {name} setName={onRename} --position="relative" />
  </div>
  <div class="port-type">{formatConnectableType(port.type)}</div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: row;
    align-items: center;
    background: #171717;
    padding: 3px 4px;
    font-family: 'Hack', monospace;
  }

  .root > div {
    display: flex;
  }

  .delete-button {
    color: #ff0000;
    cursor: pointer;
    margin-right: 4px;
    font-size: 28px;
    line-height: 0;
    padding-right: 4px;
  }

  .port-name {
    flex: 1;
  }

  .port-type {
    width: 50px;
  }
</style>
