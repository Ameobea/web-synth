<script lang="ts">
  export let onSubmit: () => void;
  export let onCancel: () => void;
</script>

<div class="root">
  <p>Are you sure you want to reset completely to scratch?</p>
  <div class="buttons-container">
    <button on:click={onSubmit}>Reset</button>
    <button on:click={onCancel}>Cancel</button>
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 400px;
    height: 150px;
    gap: 30px;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #222;
    padding: 12px;
    border: 1px solid #555;
  }

  .buttons-container {
    display: flex;
    flex-direction: row;
    gap: 10px;
  }
</style>
