const ctx = new AudioContext();

export const globalTempoCSN = new ConstantSourceNode(ctx);
(window as any).globalTempoCSN = globalTempoCSN;
globalTempoCSN.offset.value = +(localStorage.getItem('globalTempo') ?? 120);
globalTempoCSN.start();

export const getGlobalBpm = () => globalTempoCSN.offset.value;

export const setGlobalBpm = (newGlobalTempo: number) => {
  globalTempoCSN.offset.value = newGlobalTempo;
  localStorage.globalTempo = newGlobalTempo.toFixed(1);
};
