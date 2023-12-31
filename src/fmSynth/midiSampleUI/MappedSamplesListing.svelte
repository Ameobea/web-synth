<script lang="ts" context="module">
  const MIDI_NOTE_RANGE = new Array(100).fill(null).map((_, i) => i);
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';

  import ConfigureMIDIMapping from 'src/fmSynth/midiSampleUI/ConfigureMIDIMapping.svelte';
  import MappedNoteRow from 'src/fmSynth/midiSampleUI/MappedNoteRow.svelte';
  import {
    buildDefaultMappedSampleData,
    type SampleMappingOperatorState,
  } from 'src/graphEditor/nodes/CustomAudio/FMSynth/sampleMapping';
  import type { GateUngateCallbackRegistrar } from './types';

  export let registerGateUngateCallbacks: GateUngateCallbackRegistrar;
  export let state: SampleMappingOperatorState;
  export let selectedMIDINumber: number | null;

  let isLearningMIDIMapping = false;

  let gatedNotes: { [midiNumber: number]: true | false } = {};
  let unregisterGateCBs: (() => void) | undefined;
  $: {
    unregisterGateCBs?.();

    const onGate = (midiNumber: number) => {
      gatedNotes[midiNumber] = true;

      if (isLearningMIDIMapping) {
        selectedMIDINumber = midiNumber;
        state.mappedSamplesByMIDINumber[midiNumber] = [
          ...(state.mappedSamplesByMIDINumber[midiNumber] ?? []),
          buildDefaultMappedSampleData(),
        ];
        isLearningMIDIMapping = false;
      }
    };
    const onUngate = (midiNumber: number) => {
      gatedNotes[midiNumber] = false;
    };

    const { unregister } = registerGateUngateCallbacks(onGate, onUngate);
    unregisterGateCBs = unregister;
  }

  onDestroy(() => unregisterGateCBs?.());

  $: noteIDsToRender = state.showUnmappedNotesInListing
    ? MIDI_NOTE_RANGE
    : MIDI_NOTE_RANGE.filter(
        midiNumber =>
          (state.mappedSamplesByMIDINumber[midiNumber]?.length ?? 0) > 0 || gatedNotes[midiNumber]
      );

  const uniqueID = genRandomStringID();
</script>

<div class="root">
  <div class="controls">
    <div>
      <label for={`${uniqueID}-show-unmapped-notes-toggle`}>Show Unmapped Notes</label>
      <input
        type="checkbox"
        id={`${uniqueID}-show-unmapped-notes-toggle`}
        bind:checked={state.showUnmappedNotesInListing}
      />
    </div>
    <div>
      {#if isLearningMIDIMapping}
        TODO
      {:else}
        <button on:click={() => (isLearningMIDIMapping = true)}>Learn MIDI Mapping</button>
      {/if}
    </div>
  </div>
  <div class="listing">
    {#each noteIDsToRender as midiNumber}
      <MappedNoteRow
        {midiNumber}
        mappedSamples={state.mappedSamplesByMIDINumber[midiNumber]}
        on:click={() => {
          selectedMIDINumber = midiNumber === selectedMIDINumber ? null : midiNumber;
        }}
        isGated={!!gatedNotes[midiNumber]}
      />
      {#if selectedMIDINumber === midiNumber}
        <ConfigureMIDIMapping
          onClose={() => {
            selectedMIDINumber = null;
          }}
          bind:mappedSamples={state.mappedSamplesByMIDINumber[midiNumber]}
        />
      {/if}
    {/each}
  </div>
  {#if noteIDsToRender.length === 0}
    <i class="no-samples-mapped">
      No samples mapped. Use the controls above to map samples to MIDI notes.
    </i>
  {/if}
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
  }

  .listing {
    margin-top: 8px;
    max-height: 300px;
    overflow-y: auto;
    box-sizing: border-box;
    border: 1px solid #888;
    overflow-x: hidden;
  }

  .controls {
    display: flex;
    flex-direction: column;
    padding: 6px;
    margin-top: -4px;
  }

  .controls > * {
    margin-top: 4px;
  }

  button {
    height: 26px;
  }

  .no-samples-mapped {
    color: #888;
    text-align: center;
    font-size: 15px;
    margin-top: 10px;
  }
</style>
