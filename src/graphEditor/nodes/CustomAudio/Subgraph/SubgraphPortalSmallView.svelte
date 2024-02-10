<script lang="ts">
  import type { PortMap } from 'src/graphEditor/nodes/CustomAudio/Subgraph/SubgraphPortalNode';
  import type { Writable } from 'svelte/store';
  import PortList from './PortList.svelte';

  export let inputs: Writable<PortMap>;
  export let outputs: Writable<PortMap>;
  export let renamePort: (side: 'input' | 'output', oldName: string, newName: string) => void;
  export let deletePort: (ports: Writable<PortMap>, name: string) => void;
</script>

<div class="root">
  <PortList
    title="Inputs"
    ports={inputs}
    renamePort={(oldName, newName) => renamePort('input', oldName, newName)}
    deletePort={name => deletePort(inputs, name)}
  />
  <PortList
    title="Outputs"
    ports={outputs}
    renamePort={(oldName, newName) => renamePort('output', oldName, newName)}
    deletePort={name => deletePort(outputs, name)}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
</style>
