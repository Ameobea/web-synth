<script lang="ts">
  interface Props {
    selected: boolean;
    noteType: 'white' | 'black';
    onClick: () => void;
    children?: import('svelte').Snippet;
  }

  let {
    selected,
    noteType,
    onClick,
    children
  }: Props = $props();
</script>

<div
  class="note"
  data-selected={selected}
  data-note-type={noteType}
  onclick={onClick}
  onkeyup={() => {}}
  tabindex="0"
  role="button"
>
  {@render children?.()}
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
