<script lang="ts">
  import * as R from 'ramda';

  export let name: string;
  export let setName: (name: string) => void;
  export let left: number | undefined = undefined;
  export let right: number | undefined = undefined;

  let isEditingName = false;
  let nameWrapperHovered = false;
  let editingNameValue = name;
</script>

<div
  class="name-wrapper"
  style="left: {R.isNil(left) ? 'unset' : `${left}px`}; right: {R.isNil(right)
    ? 'unset'
    : `${right}px`};"
  on:mouseenter={() => {
    nameWrapperHovered = true;
  }}
  on:mouseleave={() => {
    nameWrapperHovered = false;
  }}
  role="heading"
  aria-level={2}
>
  {#if isEditingName}
    <input
      type="text"
      bind:value={editingNameValue}
      on:blur={() => {
        isEditingName = false;
      }}
      on:keydown={e => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          isEditingName = false;
          if (editingNameValue !== name) {
            setName(editingNameValue);
          }
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          isEditingName = false;
        }
      }}
      on:click={e => e.stopPropagation()}
      class="name-input"
    />
  {:else}
    <span style="pointer-events: none">{name}</span>
  {/if}
  <span
    class="edit-name"
    style="visibility: {nameWrapperHovered && !isEditingName
      ? 'visible'
      : 'hidden'}; font-size: var(--icon-font-size, 16px);"
    on:click={e => {
      e.stopPropagation();
      isEditingName = true;
    }}
    role="button"
    aria-label="Edit name"
    tabindex="0"
    on:keydown={e => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        isEditingName = true;
      }
    }}
  >
    ✎
  </span>
</div>

<style lang="css">
  .name-wrapper {
    margin-left: 4px;
    margin-top: -3px;
    position: var(--position, absolute);
    user-select: none;
  }

  .name-wrapper,
  input[type='text'] {
    font-family:
      Hack,
      Oxygen Mono,
      Menlo,
      monospace;
    font-size: var(--font-size, 13px);
  }

  .edit-name {
    cursor: pointer;
  }

  .name-input {
    height: 20px;
    margin-bottom: 4px;
    margin-top: -2px;
  }
</style>
