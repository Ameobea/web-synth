import type { SampleDescriptor } from 'src/sampleLibrary';

interface SerializedMappedSampleData {
  descriptor: SampleDescriptor | null;
}

export interface SerializedSampleMappingState {
  mappedSamplesByMIDINumber: { [midiNumber: number]: SerializedMappedSampleData[] };
  selectedMIDINumber: number | null;
}

export interface MappedSampleData {
  descriptor: SampleDescriptor | null;
  loadStatus:
    | { type: 'notLoaded' }
    | { type: 'loading' }
    | { type: 'loadError'; message: string }
    | { type: 'loaded' };
}

export const buildDefaultMappedSampleData = (): MappedSampleData => ({
  descriptor: null,
  loadStatus: { type: 'loading' },
});

export interface SampleMappingState {
  mappedSamplesByMIDINumber: { [midiNumber: number]: MappedSampleData[] };
  selectedMIDINumber: number | null;
}

export const serializeSampleMappingState = (
  state: SampleMappingState
): SerializedSampleMappingState => {
  const mappedSamplesByMIDINumber: { [midiNumber: number]: SerializedMappedSampleData[] } = {};
  for (const [midiNumber, mappedSampleData] of Object.entries(state.mappedSamplesByMIDINumber)) {
    mappedSamplesByMIDINumber[+midiNumber] = mappedSampleData.map(({ descriptor }) => ({
      descriptor: descriptor,
    }));
  }

  return { mappedSamplesByMIDINumber, selectedMIDINumber: state.selectedMIDINumber }; // TODO
};

export const deserializeSampleMappingState = (
  serialized: SerializedSampleMappingState
): SampleMappingState => {
  const mappedSamplesByMIDINumber: { [midiNumber: number]: MappedSampleData[] } = {};
  for (const [midiNumber, mappedSampleData] of Object.entries(
    serialized.mappedSamplesByMIDINumber
  )) {
    mappedSamplesByMIDINumber[+midiNumber] = mappedSampleData.map(({ descriptor }) => ({
      descriptor,
      loadStatus: { type: 'notLoaded' },
    }));
  }

  return {
    mappedSamplesByMIDINumber,
    selectedMIDINumber: serialized.selectedMIDINumber ?? null,
  }; // TODO
};

export const buildDefaultSampleMappingState = (): SampleMappingState => ({
  mappedSamplesByMIDINumber: {},
  selectedMIDINumber: null,
});
