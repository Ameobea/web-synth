export interface MIDIQuantizerNodeUIState {
  octaveRange: [number, number];
  activeNotes: [
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean
  ];
  isRunning: boolean;
}

export const buildDefaultMIDIQuantizerNodeUIState = (): MIDIQuantizerNodeUIState => ({
  octaveRange: [0, 2],
  activeNotes: [true, true, true, true, true, true, true, true, true, true, true, true],
  isRunning: true,
});
