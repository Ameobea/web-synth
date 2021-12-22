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
  /**
   * If `true`, then this node will start and stop when the global beat counter is started/stopped. Otherwise, it will
   * be started and stopped manually with a button in the node's UI.
   */
  startOnGlobalStart: boolean;
}

export const buildDefaultMIDIQuantizerNodeUIState = (): MIDIQuantizerNodeUIState => ({
  octaveRange: [0, 2],
  activeNotes: [true, true, true, true, true, true, true, true, true, true, true, true],
  isRunning: true,
  startOnGlobalStart: false,
});
