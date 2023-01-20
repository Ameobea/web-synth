import type { SampleDescriptor } from 'src/sampleLibrary';

interface SerializedMappedSampleData {
  descriptor: SampleDescriptor | null;
  doLoop: boolean;
  gain?: number;
  startIx?: number;
  endIx?: number;
  playbackRate?: number;
}

export interface SerializedSampleMappingOperatorState {
  selectedMIDINumber: number | null;
  mappedSamplesListingExpanded: boolean;
  showUnmappedNotesInListing: boolean;
  mappedSamplesByMIDINumber: { [midiNumber: number]: SerializedMappedSampleData[] };
}

export interface SerializedSampleMappingState {
  stateByOperatorIx: { [operatorIx: number]: SerializedSampleMappingOperatorState };
}

export interface MappedSampleData {
  descriptor: SampleDescriptor | null;
  doLoop: boolean;
  loadStatus:
    | { type: 'notLoaded' }
    | { type: 'loading' }
    | { type: 'loadError'; message: string }
    | { type: 'loaded' };
  gain: number;
  startIx?: number;
  endIx?: number;
  playbackRate: number;
}

export const buildDefaultMappedSampleData = (): MappedSampleData => ({
  descriptor: null,
  doLoop: false,
  loadStatus: { type: 'loading' },
  gain: 1,
  playbackRate: 1,
});

export interface SampleMappingOperatorState {
  mappedSamplesByMIDINumber: { [midiNumber: number]: MappedSampleData[] };
  selectedMIDINumber: number | null;
  mappedSamplesListingExpanded: boolean;
  showUnmappedNotesInListing: boolean;
}

export interface SampleMappingState {
  stateByOperatorIx: { [operatorIx: number]: SampleMappingOperatorState };
}

const serializeSampleMappingOperatorState = (
  state: SampleMappingOperatorState
): SerializedSampleMappingOperatorState => {
  const mappedSamplesByMIDINumber: { [midiNumber: number]: SerializedMappedSampleData[] } = {};
  for (const [midiNumber, mappedSampleData] of Object.entries(state.mappedSamplesByMIDINumber)) {
    mappedSamplesByMIDINumber[+midiNumber] = mappedSampleData.map(
      ({ descriptor, doLoop, startIx, endIx, gain, playbackRate }) => ({
        descriptor,
        doLoop,
        startIx,
        endIx,
        gain,
        playbackRate,
      })
    );
  }

  return {
    mappedSamplesByMIDINumber,
    selectedMIDINumber: state.selectedMIDINumber,
    mappedSamplesListingExpanded: state.mappedSamplesListingExpanded,
    showUnmappedNotesInListing: state.showUnmappedNotesInListing,
  };
};

export const serializeSampleMappingState = (
  state: SampleMappingState
): SerializedSampleMappingState => {
  const stateByOperatorIx: { [operatorIx: number]: SerializedSampleMappingOperatorState } = {};
  for (const [operatorIx, opState] of Object.entries(state.stateByOperatorIx)) {
    stateByOperatorIx[+operatorIx] = serializeSampleMappingOperatorState(opState);
  }

  return { stateByOperatorIx };
};

const deserializeSampleMappingOperatorState = (
  serialized: SerializedSampleMappingOperatorState
): SampleMappingOperatorState => {
  const mappedSamplesByMIDINumber: { [midiNumber: number]: MappedSampleData[] } = {};
  for (const [midiNumber, mappedSampleData] of Object.entries(
    serialized.mappedSamplesByMIDINumber
  )) {
    mappedSamplesByMIDINumber[+midiNumber] = mappedSampleData.map(
      ({ descriptor, doLoop, startIx, endIx, gain, playbackRate }) => ({
        descriptor,
        doLoop,
        loadStatus: { type: 'notLoaded' },
        startIx,
        endIx,
        gain: gain ?? 1,
        playbackRate: playbackRate ?? 1,
      })
    );
  }

  return {
    mappedSamplesByMIDINumber,
    selectedMIDINumber: serialized.selectedMIDINumber ?? null,
    mappedSamplesListingExpanded: serialized.mappedSamplesListingExpanded,
    showUnmappedNotesInListing: serialized.showUnmappedNotesInListing,
  };
};

export const deserializeSampleMappingState = (
  serialized: SerializedSampleMappingState
): SampleMappingState => {
  const stateByOperatorIx: { [operatorIx: number]: SampleMappingOperatorState } = {};
  for (const [operatorIx, serializedOpState] of Object.entries(serialized.stateByOperatorIx)) {
    stateByOperatorIx[+operatorIx] = deserializeSampleMappingOperatorState(serializedOpState);
  }

  return { stateByOperatorIx };
};

export const buildDefaultSampleMappingState = (): SampleMappingState => ({
  stateByOperatorIx: {},
});

export const buildDefaultSampleMappingOperatorState = (): SampleMappingOperatorState => ({
  mappedSamplesByMIDINumber: {},
  selectedMIDINumber: null,
  mappedSamplesListingExpanded: true,
  showUnmappedNotesInListing: false,
});
