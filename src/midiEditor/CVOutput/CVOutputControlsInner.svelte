<script lang="ts">
  import type { Writable } from 'svelte/store';

  import SvelteADSR2 from 'src/controls/adsr2/SvelteADSR2.svelte';
  import type { CVOutputState } from 'src/midiEditor/CVOutput/CVOutput';

  export let name: string;
  export let setName: (name: string) => void;
  export let state: Writable<CVOutputState>;
  export let collapse: () => void;
  export let deleteOutput: () => void;

  let isEditingName = false;
  let nameWrapperHovered = false;
  let editingNameValue = name;

  // auto-updated width of the component
  let width: number | undefined;
  let widthObserver: ResizeObserver | undefined;
  let widthObserverTarget: HTMLElement | undefined;

  $: if (widthObserverTarget) {
    widthObserver?.unobserve(widthObserverTarget);
    widthObserver = new ResizeObserver(entries => {
      width = entries[0].contentRect.width;
    });
    widthObserver.observe(widthObserverTarget);
  }
</script>

<div class="root cv-output-controls" bind:this={widthObserverTarget}>
  <header
    on:click={collapse}
    tabindex="0"
    on:keydown={e => e.key === 'Enter' && collapse()}
    aria-label="Collapse"
    role="button"
  >
    ⌄ <div
      class="name-wrapper"
      on:mouseenter={() => {
        nameWrapperHovered = true;
      }}
      on:mouseleave={() => {
        nameWrapperHovered = false;
      }}
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
            }
          }}
          on:click={e => e.stopPropagation()}
          class="name-input"
        />
      {:else}
        {name}
      {/if}
      <span
        style="visibility: {nameWrapperHovered ? 'visible' : 'hidden'}; font-size: 21px;"
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
    <button class="delete-cv-output-button" on:click={deleteOutput}>×</button>
  </header>

  {#if width}
    <SvelteADSR2
      {width}
      height={180}
      debugName={`MIDI editor CV output ${name}`}
      initialState={{ ...$state.adsr, outputRange: [$state.minValue, $state.maxValue] }}
      onChange={newState =>
        state.update(s => ({
          ...s,
          adsr: newState,
          minValue: newState.outputRange[0],
          maxValue: newState.outputRange[1],
        }))}
      vcId={undefined}
      disableControlPanel={true}
      instanceCb={inst => {
        console.log('Got inst!!');
        // inst.setRenderedRegion({ start: 0.4, end: 0.9 });
        // TODO
      }}
    />
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    height: 240px;
  }

  .name-wrapper {
    margin-left: 4px;
  }

  .name-input {
    height: 20px;
    margin-bottom: 4px;
    margin-top: -2px;
  }
</style>
