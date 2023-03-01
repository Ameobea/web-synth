<script lang="ts">
  export let onSubmit: (val: unknown) => void;
  export let onCancel: () => void;
</script>

<div class="root basic-modal">TODO</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    width: calc(80vw - 2rem);
    height: calc(80vh - 2rem);
    background-color: #222;
  }
</style>
