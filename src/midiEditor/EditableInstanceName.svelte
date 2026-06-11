<script lang="ts">
  import * as R from 'ramda';

  interface Props {
    name: string;
    setName: (name: string) => void;
    left?: number | undefined;
    right?: number | undefined;
    transparent?: boolean;
  }

  let {
    name,
    setName,
    left = undefined,
    right = undefined,
    transparent = false
  }: Props = $props();

  let isEditingName = $state(false);
  let nameWrapperHovered = $state(false);
  let editingNameValue = $state('');

  const startEditing = () => {
    editingNameValue = name;
    isEditingName = true;
  };
</script>

<div
  class="name-wrapper"
  style="left: {R.isNil(left) ? 'unset' : `${left}px`}; right: {R.isNil(right)
    ? 'unset'
    : `${right}px`};"
  onmouseenter={() => {
    nameWrapperHovered = true;
  }}
  onmouseleave={() => {
    nameWrapperHovered = false;
  }}
  role="heading"
  aria-level={2}
>
  {#if isEditingName}
    <input
      type="text"
      bind:value={editingNameValue}
      onblur={() => {
        isEditingName = false;
      }}
      onkeydown={e => {
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
      onclick={e => e.stopPropagation()}
      class="name-input"
    />
  {:else}
    <span style="pointer-events: none" class={transparent ? 'name-transparent' : undefined}
      >{name}</span
    >
  {/if}
  <span
    class="edit-name"
    style="visibility: {nameWrapperHovered && !isEditingName
      ? 'visible'
      : 'hidden'}; font-size: var(--icon-font-size, 16px);"
    onclick={e => {
      e.stopPropagation();
      startEditing();
    }}
    role="button"
    aria-label="Edit name"
    tabindex="0"
    onkeydown={e => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        startEditing();
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
    z-index: 1;
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

  .name-transparent {
    background: rgba(0, 0, 0, 0.8);
    padding-left: 5px;
    margin-left: -4px;
  }
</style>
