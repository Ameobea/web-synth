<script lang="ts" module>
  const dpr = window.devicePixelRatio ?? 1;
</script>

<script lang="ts">
  import type { Writable } from 'svelte/store';

  import type { ADSR2Instance } from 'src/controls/adsr2/adsr2';
  import { LEFT_GUTTER_WIDTH_PX } from 'src/controls/adsr2/adsr2Helpers';
  import SvelteADSR2 from 'src/controls/adsr2/SvelteADSR2.svelte';
  import { renderModalWithControls } from 'src/controls/Modal';
  import { AdsrLengthMode } from 'src/graphEditor/nodes/CustomAudio/FMSynth';
  import { PIANO_KEYBOARD_WIDTH } from 'src/midiEditor/conf';
  import type { CVOutputState } from 'src/midiEditor/CVOutput/CVOutput';
  import EditableInstanceName from 'src/midiEditor/EditableInstanceName.svelte';
  import { mkCVOutputSettingsPopup } from './CVOutputSettingsPopup';
  import type { MIDIEditorBaseView } from 'src/midiEditor';
  import Cursor from 'src/midiEditor/CVOutput/Cursor.svelte';
  import SvelteDragHandle from 'src/midiEditor/SvelteDragHandle.svelte';

  interface Props {
    name: string;
    setName: (name: string) => void;
    state: Writable<CVOutputState>;
    collapse: () => void;
    deleteOutput: () => void;
    registerInstance: (instance: ADSR2Instance) => void;
    setFrozenOutputValue: (frozenOutputValue: number) => void;
    view: MIDIEditorBaseView;
    getCursorPosBeats: () => number;
    setCursorPosBeats: (newCursorPosBeats: number) => void;
    activateDrag: () => void;
  }

  let {
    name,
    setName,
    state: stateStore,
    collapse,
    deleteOutput,
    registerInstance,
    setFrozenOutputValue,
    view,
    getCursorPosBeats,
    setCursorPosBeats,
    activateDrag
  }: Props = $props();

  let width: number | undefined = $state();
  let widthObserverTarget: HTMLElement | undefined = $state();

  $effect(() => {
    if (!widthObserverTarget) {
      return;
    }
    const widthObserver = new ResizeObserver(entries => {
      width = entries[0].contentRect.width - 43;
    });
    widthObserver.observe(widthObserverTarget);
    return () => widthObserver.disconnect();
  });

  const openSettings = () =>
    renderModalWithControls(mkCVOutputSettingsPopup($stateStore))
      .then(newState => stateStore.update(s => ({ ...s, ...newState })))
      .catch(() => {});
</script>

<div class="root cv-output-controls" bind:this={widthObserverTarget}>
  <header
    onclick={collapse}
    tabindex="0"
    onkeydown={e => e.key === 'Enter' && collapse()}
    aria-label="Collapse"
    role="button"
  >
    ⌄
    <SvelteDragHandle
      {activateDrag}
      style={{ zIndex: 2, top: 0, left: 28, position: 'absolute' }}
    />
    <EditableInstanceName {name} {setName} left={60} />
    <button class="delete-cv-output-button" onclick={deleteOutput}>✕</button>
  </header>

  <div
    class="open-settings-button"
    onclick={openSettings}
    tabindex="0"
    onkeydown={e => e.key === 'Enter' && openSettings()}
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
          ...$stateStore.adsr,
          outputRange: [$stateStore.minValue, $stateStore.maxValue],
          lengthMode: AdsrLengthMode.Beats,
        }}
        onChange={newState => {
          stateStore.update(s => ({
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
    height: 18px;
    font-size: 14px;
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
    top: 18px;
    left: 0px;
    border: 1px solid #333;
    cursor: pointer;
    user-select: none;
  }
</style>
