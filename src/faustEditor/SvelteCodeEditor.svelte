<script lang="ts">
  import ReactShim from 'src/misc/ReactShim.svelte';
  import CodeEditor from './CodeEditor';

  export let value: string;
  export let onChange: (newContent: string) => void;
  export let mode: string | undefined;
</script>

<ReactShim Component={CodeEditor} props={{ value, onChange, mode }} />
