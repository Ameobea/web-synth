<script lang="ts">
  import ConfigureEffects from 'src/fmSynth/ConfigureEffects';
  import ReactShim from 'src/misc/ReactShim.svelte';
  interface Props {
    [key: string]: any
  }

  let { ...props }: Props = $props();
</script>

<ReactShim Component={ConfigureEffects} props={props} />
