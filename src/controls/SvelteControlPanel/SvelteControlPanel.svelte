<script lang="ts">
  import ControlPanel from 'react-control-panel';

  import ReactShim from 'src/misc/ReactShim.svelte';

  type $$Props = Record<string, any>;
</script>

<ReactShim Component={ControlPanel} props={$$props} />
