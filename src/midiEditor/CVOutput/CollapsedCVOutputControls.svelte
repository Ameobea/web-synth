<script lang="ts">
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
  › {name}
  <button class="delete-cv-output-button" on:click={deleteOutput}>×</button>
</div>
