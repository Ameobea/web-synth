use std::collections::HashMap;

use crate::{
    models::waveform::Waveform,
    schema::{synth_presets, voice_presets},
};

#[derive(Serialize, Deserialize)]
pub struct SynthPreset {
    pub voices: Vec<VoiceDefinition>,
}

#[derive(Serialize, Deserialize)]
pub struct InlineSynthPreset {
    pub voices: Vec<VoiceDefinition>,
}

#[derive(Serialize, Deserialize)]
pub enum SynthType {
    #[serde(rename = "sine")]
    Sine,
    #[serde(rename = "square")]
    Square,
    #[serde(rename = "sawtooth")]
    Sawtooth,
    #[serde(rename = "triangle")]
    Triangle,
}

#[derive(Serialize, Deserialize)]
pub struct WavetableSettings {
    // TODO?
}

// Lowpass = 'lowpass',
// Highpass = 'highpass',
// Bandpass = 'bandpass',
// Lowshelf = 'lowshelf',
// Highshelf = 'highshelf',
// Peaking = 'peaking',
// Notch = 'notch',
// Allpass = 'allpass',
#[derive(Serialize, Deserialize)]
pub enum FilterType {
    #[serde(rename = "lowpass")]
    Lowpass,
    #[serde(rename = "highpass")]
    Highpass,
    #[serde(rename = "bandpass")]
    Bandpass,
    #[serde(rename = "lowshelf")]
    Lowshelf,
    #[serde(rename = "highshelf")]
    Highshelf,
    #[serde(rename = "peaking")]
    Peaking,
    #[serde(rename = "notch")]
    Notch,
    #[serde(rename = "allpass")]
    Allpass,
}

#[derive(Serialize, Deserialize)]
pub struct FilterParams {
    #[serde(rename = "type")]
    pub filter_type: FilterType,
}

// export enum EffectType {
//   Bitcrusher = 'bitcrusher',
//   Distortion = 'distortion',
//   Reverb = 'reverb',
// }
#[derive(Serialize, Deserialize)]
pub enum EffectType {
    #[serde(rename = "bitcrusher")]
    Bitcrusher,
    #[serde(rename = "distortion")]
    Distortion,
    #[serde(rename = "reverb")]
    Reverb,
}

// export interface ADSRValue {
//   // Number [0,1] indicating how far the level is from the left to the right
//   pos: number;
//   // Number [0,1] indicating at what level the value is from the bottom to the top
//   magnitude: number;
// }
#[derive(Serialize, Deserialize)]
pub struct ADSRValue {
    pub pos: f32,
    pub magnitude: f32,
}

// export interface ADSRValues {
//   attack: ADSRValue;
//   decay: ADSRValue;
//   release: ADSRValue;
// }
#[derive(Serialize, Deserialize)]
pub struct ADSRValues {
    pub attack: ADSRValue,
    pub decay: ADSRValue,
    pub release: ADSRValue,
}

fn default_pitch_multiplier() -> f32 {
    1.
}

// {
//   type: FilterType;
//   frequency: number;
//   Q?: number;
//   gain: number;
//   detune: number;
// };
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum VoiceDefinition {
    // {
    //     unison: number;
    //     waveform: Waveform;
    //     detune: number;
    //     filter: {
    //       type: FilterType;
    //       frequency: number;
    //       Q?: number;
    //       gain: number;
    //       detune: number;
    //     };
    //     masterGain: number;
    //     selectedEffectType: EffectType;
    //     gainEnvelope: ADSRValues;
    //     gainADSRLength: number;
    //     filterEnvelope: ADSRValues;
    //     filterADSRLength: number;
    //     pitchMultiplier: number;
    // }
    #[serde(rename = "standard")]
    #[serde(rename_all = "camelCase")]
    Standard {
        unison: usize,
        waveform: SynthType,
        detune: f32,
        filter: FilterParams,
        master_gain: f32,
        selected_effect_type: EffectType,
        gain_envelope: ADSRValues,
        #[serde(rename = "gainADSRLength")]
        gain_adsr_length: f32,
        filter_envelope: ADSRValues,
        #[serde(rename = "filterADSRLength")]
        filter_adsr_length: f32,
        #[serde(default = "default_pitch_multiplier")]
        pitch_multiplier: f32,
        #[serde(default)]
        unison_spread_cents: f32,
    },
    #[serde(rename = "wavetable")]
    #[serde(rename_all = "camelCase")]
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

#[derive(Serialize)]
pub struct SynthPresetEntry {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub body: SynthPreset,
}

#[derive(Serialize)]
pub struct InlineSynthPresetEntry {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub body: InlineSynthPreset,
}

#[derive(Deserialize)]
pub struct ReceivedSynthPresetEntry {
    pub title: String,
    pub description: String,
    pub body: SynthPreset,
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

#[derive(Deserialize)]
pub struct UserProvidedNewSynthVoicePreset {
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
