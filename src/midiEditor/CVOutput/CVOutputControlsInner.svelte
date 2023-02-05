<script lang="ts">
  import type { Writable } from 'svelte/store';

  import { ADSR2Instance, LEFT_GUTTER_WIDTH_PX } from 'src/controls/adsr2/adsr2';
  import SvelteADSR2 from 'src/controls/adsr2/SvelteADSR2.svelte';
  import { renderModalWithControls } from 'src/controls/Modal';
  import { PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import type { CVOutputState } from 'src/midiEditor/CVOutput/CVOutput';
  import { mkCVOutputSettingsPopup } from './CVOutputSettingsPopup';

  export let name: string;
  export let setName: (name: string) => void;
  export let state: Writable<CVOutputState>;
  export let collapse: () => void;
  export let deleteOutput: () => void;
  export let registerInstance: (instance: ADSR2Instance) => void;
  export let setFrozenOutputValue: (frozenOutputValue: number) => void;

  let isEditingName = false;
  let nameWrapperHovered = false;
  let editingNameValue = name;

  // auto-updated width of the component
  let forceNoRender = false;
  let lastWidth: number | undefined;
  let width: number | undefined;
  let widthObserver: ResizeObserver | undefined;
  let widthObserverTarget: HTMLElement | undefined;

  $: if (widthObserverTarget) {
    widthObserver?.unobserve(widthObserverTarget);
    widthObserver = new ResizeObserver(entries => {
      const newWidth = entries[0].contentRect.width - 109;
      if (lastWidth !== undefined && newWidth !== lastWidth) {
        forceNoRender = true;
      }
      lastWidth = newWidth;
      width = newWidth;
    });
    widthObserver.observe(widthObserverTarget);
  }
  $: if (forceNoRender) {
    forceNoRender = false;
  }

  const openSettings = () =>
    renderModalWithControls(mkCVOutputSettingsPopup($state))
      .then(newState => state.update(s => ({ ...s, ...newState })))
      .catch(() => {});
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

  <div
    class="open-settings-button"
    on:click={openSettings}
    tabindex="0"
    on:keydown={e => e.key === 'Enter' && openSettings()}
    aria-label="Open settings"
    role="button"
  >
    ⚙
  </div>

  {#if !forceNoRender && width && width > 0}
    <div style="margin-left: {PIANO_KEYBOARD_WIDTH - LEFT_GUTTER_WIDTH_PX}px;">
      <SvelteADSR2
        {width}
        height={220}
        debugName={`MIDI editor CV output ${name}`}
        initialState={{ ...$state.adsr, outputRange: [$state.minValue, $state.maxValue] }}
        onChange={newState => {
          state.update(s => ({
            ...s,
            adsr: newState,
            minValue: newState.outputRange[0],
            maxValue: newState.outputRange[1],
          }));
        }}
        vcId={undefined}
        disableControlPanel={true}
        instanceCb={registerInstance}
        enableInfiniteMode={true}
        disablePhaseVisualization={true}
        {setFrozenOutputValue}
      />
    </div>
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }

  .name-wrapper {
    margin-left: 4px;
  }

  .name-input {
    height: 20px;
    margin-bottom: 4px;
    margin-top: -2px;
  }

  .open-settings-button {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    line-height: 0;
    padding-top: 2px;
    position: absolute;
    top: 35px;
    left: 3px;
    border: 1px solid #333;
    cursor: pointer;
    user-select: none;
  }
</style>
