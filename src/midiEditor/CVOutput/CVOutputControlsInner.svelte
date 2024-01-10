<script lang="ts" context="module">
  const dpr = window.devicePixelRatio ?? 1;
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import { ADSR2Instance, LEFT_GUTTER_WIDTH_PX } from 'src/controls/adsr2/adsr2';
  import SvelteADSR2 from 'src/controls/adsr2/SvelteADSR2.svelte';
  import { renderModalWithControls } from 'src/controls/Modal';
  import { AdsrLengthMode } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
  import { PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import type { CVOutputState } from 'src/midiEditor/CVOutput/CVOutput';
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';
  import { mkCVOutputSettingsPopup } from './CVOutputSettingsPopup';
  import type { MIDIEditorBaseView } from 'src/midiEditor';
  import Cursor from 'src/midiEditor/CVOutput/Cursor.svelte';

  export let name: string;
  export let setName: (name: string) => void;
  export let state: Writable<CVOutputState>;
  export let collapse: () => void;
  export let deleteOutput: () => void;
  export let registerInstance: (instance: ADSR2Instance) => void;
  export let setFrozenOutputValue: (frozenOutputValue: number) => void;
  export let view: MIDIEditorBaseView;
  export let getCursorPosBeats: () => number;
  export let setCursorPosBeats: (newCursorPosBeats: number) => void;

  let width: number | undefined;
  let widthObserver: ResizeObserver | undefined;
  let widthObserverTarget: HTMLElement | undefined;

  $: if (widthObserverTarget) {
    widthObserver?.unobserve(widthObserverTarget);
    widthObserver = new ResizeObserver(entries => {
      width = entries[0].contentRect.width - 43;
    });
    widthObserver.observe(widthObserverTarget);
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
    ⌄
    <EditableInstanceName {name} {setName} left={PIANO_KEYBOARD_WIDTH} />
    <button class="delete-cv-output-button" on:click={deleteOutput}>✕</button>
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

  {#if width && width > 0}
    <div style="margin-left: {PIANO_KEYBOARD_WIDTH - LEFT_GUTTER_WIDTH_PX / dpr}px;">
      <SvelteADSR2
        {width}
        height={220}
        debugName={`MIDI editor CV output ${name}`}
        initialState={{
          ...$state.adsr,
          outputRange: [$state.minValue, $state.maxValue],
          lengthMode: AdsrLengthMode.Beats,
        }}
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
      <Cursor
        {width}
        height={210}
        {view}
        {getCursorPosBeats}
        {setCursorPosBeats}
        marginLeft={PIANO_KEYBOARD_WIDTH}
        marginTop={19}
      />
    </div>
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    position: relative;
  }

  header {
    height: 19px;
    font-size: 14px;
    line-height: 8px;
  }

  .open-settings-button {
    width: 17px;
    height: 17px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 19px;
    line-height: 10px;
    padding-top: 2px;
    position: absolute;
    top: 19px;
    left: 0px;
    border: 1px solid #333;
    cursor: pointer;
    user-select: none;
  }
</style>
