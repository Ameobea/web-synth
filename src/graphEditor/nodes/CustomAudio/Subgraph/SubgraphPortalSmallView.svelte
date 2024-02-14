<script lang="ts">
  import type { PortMap } from 'src/graphEditor/nodes/CustomAudio/Subgraph/SubgraphPortalNode';
  import type { Writable } from 'svelte/store';
  import PortList from './PortList.svelte';
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';
  import { svelteStoreFromRedux } from 'src/svelteUtils';

  export let inputs: Writable<PortMap>;
  export let outputs: Writable<PortMap>;
  export let renamePort: (side: 'input' | 'output', oldName: string, newName: string) => void;
  export let deletePort: (side: 'input' | 'output', name: string) => void;
  export let setSubgraphName: (newName: string) => void;
  export let rxSubgraphID: string;

  const subgraphName = svelteStoreFromRedux(
    state => state.viewContextManager.subgraphsByID[rxSubgraphID]?.name
  );
</script>

<div class="root">
  <div class="subgraph-name">
    <EditableInstanceName
      left={0}
      --position="relative"
      --font-size="18px"
      --icon-font-size="22px"
      name={$subgraphName}
      setName={setSubgraphName}
    />
  </div>
  <PortList
    title="Inputs"
    ports={inputs}
    renamePort={(oldName, newName) => renamePort('input', oldName, newName)}
    deletePort={name => deletePort('input', name)}
  />
  <PortList
    title="Outputs"
    ports={outputs}
    renamePort={(oldName, newName) => renamePort('output', oldName, newName)}
    deletePort={name => deletePort('output', name)}
  />
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .subgraph-name {
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid #333;
    padding-bottom: 2px;
    font-weight: bold;
  }
</style>
