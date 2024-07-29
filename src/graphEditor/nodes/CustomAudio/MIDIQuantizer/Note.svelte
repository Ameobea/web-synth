<script lang="ts">
  export let selected: boolean;
  export let noteType: 'white' | 'black';
  export let onClick: () => void;
</script>

<div
  class="note"
  data-selected={selected}
  data-note-type={noteType}
  on:click={onClick}
  on:keyup={() => {}}
  tabindex="0"
  role="button"
>
  <slot />
</div>

<style lang="css">
  .note {
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    width: 30px;
    height: 30px;
    border-radius: 5px;
    margin-left: 2px;
    margin-right: 2px;
    user-select: none;
  }

  .note[data-note-type='white'] {
    background-color: #d4d4d4;
    border: 1px solid #1e1e1e;
    color: #1e1e1e;
  }

  .note[data-note-type='black'] {
    background-color: #1e1e1e;
    border: 1px solid #bbb;
    color: #dedede;
  }

  .note[data-selected='true'] {
    background-color: #e309c6;
    color: #1e1e1e !important;
    border: none !important;
  }
</style>
