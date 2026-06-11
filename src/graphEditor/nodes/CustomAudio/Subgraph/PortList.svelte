<script lang="ts">
  import PortListItem from 'src/graphEditor/nodes/CustomAudio/Subgraph/PortListItem.svelte';
  import type { PortMap } from 'src/graphEditor/nodes/CustomAudio/Subgraph/SubgraphPortalNode';
  import type { Writable } from 'svelte/store';

  interface Props {
    title: string;
    ports: Writable<PortMap>;
    renamePort: (oldName: string, newName: string) => void;
    deletePort: (name: string) => void;
  }

  let {
    title,
    ports,
    renamePort,
    deletePort
  }: Props = $props();

  let sortedPorts = $derived((() => {
    const entries = Object.entries($ports);
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries;
  })());
</script>

<div class="root">
  <h3>{title}</h3>
  <div class="port-list">
    {#each sortedPorts as [name, port]}
      <PortListItem
        {port}
        {name}
        onDelete={() => deletePort(name)}
        onRename={newName => renamePort(name, newName)}
      />
    {/each}
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
  }

  .root:last-of-type {
    border-top: 1px solid #333;
  }

  .port-list {
    margin-top: 6px;
  }

  h3 {
    margin: 0;
    padding: 4px 5px 0 5px;
    font-family: 'Hack', monospace;
    font-size: 16px;
    font-weight: 600;
  }
</style>
