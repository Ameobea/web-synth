const ctx = new AudioContext();

export const setGlobalVolume = (newGlobalVolume: number) => {
  localStorage.setItem('globalVolume', newGlobalVolume.toString());
  ((ctx as any).globalVolume as GainNode).gain.value = newGlobalVolume / 100;
};
