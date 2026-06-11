<script lang="ts">
  import ReactShim from 'src/misc/ReactShim.svelte';
  import CodeEditor from './CodeEditor';

  interface Props {
    value: string;
    onChange: (newContent: string) => void;
    mode: string | undefined;
    height?: number | undefined;
  }

  let {
    value,
    onChange,
    mode,
    height = undefined
  }: Props = $props();
</script>

<ReactShim Component={CodeEditor} props={{ value, onChange, mode, height }} />
