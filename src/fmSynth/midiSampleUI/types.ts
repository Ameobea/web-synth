export type GateUngateCallbackRegistrar = (
  onGate: (midiNumber: number, voiceIx: number) => void,
  onUngate: (midiNumber: number, voiceIx: number) => void
) => { unregister: () => void };
