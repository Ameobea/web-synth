export type GateUngateCallbackRegistrar = (
  onGate: (midiNumber: number) => void,
  onUngate: (midiNumber: number) => void
) => { unregister: () => void };
