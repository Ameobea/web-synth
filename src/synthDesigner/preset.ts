export interface SynthPresetEntry {
  id: number;
  title: string;
  description: string;
  body: SynthPreset;
}

export interface SynthPreset {}

export interface SynthVoicePreset {}

export interface SynthVoicePresetEntry {
  id: number;
  title: string;
  description: string;
  body: SynthVoicePreset;
}
