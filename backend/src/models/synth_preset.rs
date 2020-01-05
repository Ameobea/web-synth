use std::collections::HashMap;

use crate::{
    models::waveform::Waveform,
    schema::{synth_presets, voice_presets},
};

#[derive(Serialize, Deserialize)]
pub struct SynthPreset {
    pub voices: Vec<VoiceDefinitionItem>,
}

#[derive(Serialize, Deserialize)]
pub struct InlineSynthPreset {
    pub voices: Vec<VoiceDefinition>,
}

#[derive(Serialize, Deserialize)]
pub enum VoiceDefinitionItem {
    External { id: i64 },
    Anonymous(VoiceDefinition),
}

#[derive(Serialize, Deserialize)]
pub enum SynthType {
    Sine,
    Square,
    Sawtooth,
    Triangle,
}

#[derive(Serialize, Deserialize)]
pub struct WavetableSettings {
    // TODO?
}

#[derive(Serialize, Deserialize)]
pub enum VoiceDefinition {
    Standard {
        synth_type: SynthType,
    },
    Wavetable {
        settings: WavetableSettings,
        dimensions: Vec<Waveform>,
        mixes: Vec<f32>,
        // TODO
    },
}

pub enum Effect {
    Reverb {
        intensity: f32,
    },
    Delay {
        duration_samples: f32,
    },
    Distortion {
        intensity: f32,
    },
    Faust {
        module_id: String,
        params: HashMap<String, serde_json::Value>,
    },
}

#[derive(Serialize, Deserialize)]
pub struct SynthPresetEntry {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub body: SynthPreset,
}

#[derive(Serialize, Deserialize)]
pub struct InlineSynthPresetEntry {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub body: InlineSynthPreset,
}

#[derive(Insertable)]
#[table_name = "synth_presets"]
pub struct NewSynthPresetEntry {
    pub title: String,
    pub description: String,
    pub body: String,
}

#[derive(Serialize, Deserialize)]
pub struct SynthVoicePresetEntry {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub body: VoiceDefinition,
}

#[derive(Insertable)]
#[table_name = "voice_presets"]
pub struct NewSynthVoicePresetEntry {
    pub title: String,
    pub description: String,
    pub body: String,
}
