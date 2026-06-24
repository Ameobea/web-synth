use crate::schema::{synth_presets, voice_presets};

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
  #[serde(rename = "fm")]
  Fm,
}

// Lowpass = 'lowpass',
// LP4 = 'order 4 lowpass',
// LP8 = 'order 8 lowpass',
// LP16 = 'order 16 lowpass',
// Highpass = 'highpass',
// HP4 = 'order 4 highpass',
// HP8 = 'order 8 highpass',
// HP16 = 'order 16 highpass',
// Bandpass = 'bandpass',
// BP4 = 'order 4 bandpass',
// BP8 = 'order 8 bandpass',
// BP16 = 'order 16 bandpass',
// DynaBP_50 = 'dynamic bandpass (50 Hz)',
// DynaBP_100 = 'dynamic bandpass (100 Hz)',
// DynaBP_200 = 'dynamic bandpass (200 Hz)',
// DynaBP_400 = 'dynamic bandpass (400 Hz)',
// DynaBP_800 = 'dynamic bandpass (800 Hz)',
// Lowshelf = 'lowshelf',
// Highshelf = 'highshelf',
// Peaking = 'peaking',
// Notch = 'notch',
// Allpass = 'allpass',
#[derive(Serialize, Deserialize)]
pub enum FilterType {
  #[serde(rename = "lowpass")]
  Lowpass,
  #[serde(rename = "order 4 lowpass")]
  LP4,
  #[serde(rename = "order 8 lowpass")]
  LP8,
  #[serde(rename = "order 16 lowpass")]
  LP16,
  #[serde(rename = "highpass")]
  Highpass,
  #[serde(rename = "order 4 highpass")]
  HP4,
  #[serde(rename = "order 8 highpass")]
  HP8,
  #[serde(rename = "order 16 highpass")]
  HP16,
  #[serde(rename = "bandpass")]
  Bandpass,
  #[serde(rename = "order 4 bandpass")]
  BP4,
  #[serde(rename = "order 8 bandpass")]
  BP8,
  #[serde(rename = "order 16 bandpass")]
  BP16,
  #[serde(rename = "dynamic bandpass (50 Hz)")]
  DynaBP50,
  #[serde(rename = "dynamic bandpass (100 Hz)")]
  DynaBP100,
  #[serde(rename = "dynamic bandpass (200 Hz)")]
  DynaBP200,
  #[serde(rename = "dynamic bandpass (400 Hz)")]
  DynaBP400,
  #[serde(rename = "dynamic bandpass (800 Hz)")]
  DynaBP800,
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

// export interface FilterParams {
//     type: FilterType;
//     frequency: number;
//     Q?: number;
//     gain: number;
//     detune: number;
// }
#[derive(Serialize, Deserialize)]
pub struct FilterParams {
  #[serde(rename = "type")]
  pub filter_type: FilterType,
  pub frequency: f64,
  #[serde(rename = "Q", default)]
  pub q: Option<f64>,
  #[serde(default)]
  pub gain: f64,
  #[serde(default)]
  pub detune: f64,
  #[serde(flatten)]
  pub rest: serde_json::Map<String, serde_json::Value>,
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

fn default_pitch_multiplier() -> f32 { 1. }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioThreadData {
  phase_index: usize,
  debug_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Point2D {
  x: f32,
  y: f32,
}

// export type RampFn =
//   | { type: 'linear' }
//   | { type: 'instant' }
//   | { type: 'exponential'; exponent: number };
//   | { type: 'bezier'; controlPoints: { x: number; y: number }[]; }
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RampFn {
  #[serde(rename = "linear")]
  Linear,
  #[serde(rename = "instant")]
  Instant,
  #[serde(rename = "exponential")]
  Exponential { exponent: f32 },
  #[serde(rename = "bezier")]
  Bezier {
    #[serde(rename = "controlPoints")]
    control_points: Vec<Point2D>,
  },
}

// export interface AdsrStep {
//     x: number;
//     y: number;
//     ramper: RampFn;
// }
#[derive(Serialize, Deserialize)]
pub struct AdsrStep {
  x: f32,
  y: f32,
  ramper: RampFn,
}

// export interface Adsr {
//     steps: AdsrStep[];
//     lenSamples: number;
//     loopPoint: number | null;
//     releasePoint: number;
//     audioThreadData: AudioThreadData;
// }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adsr {
  steps: Vec<AdsrStep>,
  len_samples: f32,
  loop_point: Option<usize>,
  release_point: f32,
  audio_thread_data: AudioThreadData,
  #[serde(flatten)]
  rest: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDefinition {
  // {
  //     filter: {
  //       type: FilterType;
  //       frequency: number;
  //       Q?: number;
  //       gain: number;
  //       detune: number;
  //     };
  //     masterGain: number;
  //     gainEnvelope: ADSRValues;
  //     gainADSRLength: number;
  //     filterEnvelope: ADSRValues;
  //     filterADSRLength: number;
  //     pitchMultiplier: number;
  // }
  fm_synth_config: serde_json::Value,
  filter: FilterParams,
  master_gain: f32,
  #[serde(default)]
  gain_envelope: Option<ADSRValues>,
  #[serde(rename = "gainADSRLength", default)]
  gain_adsr_length: Option<f32>,
  filter_envelope: Adsr,
  #[serde(rename = "filterADSRLength")]
  filter_adsr_length: f32,
  #[serde(default = "default_pitch_multiplier")]
  pitch_multiplier: f32,
  #[serde(flatten)]
  rest: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize)]
pub struct SynthPresetEntry {
  pub id: i64,
  pub title: String,
  pub description: String,
  pub body: SynthPreset,
  pub is_featured: bool,
}

#[derive(Serialize)]
pub struct InlineSynthPresetEntry {
  pub id: i64,
  pub title: String,
  pub description: String,
  pub body: InlineSynthPreset,
  pub user_id: Option<i64>,
  pub is_featured: bool,
}

#[derive(Deserialize)]
pub struct ReceivedSynthPresetEntry {
  pub title: String,
  pub description: String,
  pub body: SynthPreset,
}

#[derive(Insertable)]
#[diesel(table_name = synth_presets)]
pub struct NewSynthPresetEntry {
  pub title: String,
  pub description: String,
  pub body: String,
  pub user_id: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthVoicePresetEntry {
  pub id: i64,
  pub title: String,
  pub description: String,
  pub body: VoiceDefinition,
  pub user_id: Option<i64>,
  #[serde(default)]
  pub is_featured: bool,
}

#[derive(Deserialize)]
pub struct UserProvidedNewSynthVoicePreset {
  pub title: String,
  pub description: String,
  pub body: VoiceDefinition,
}

#[derive(Insertable)]
#[diesel(table_name = voice_presets)]
pub struct NewSynthVoicePresetEntry {
  pub title: String,
  pub description: String,
  pub body: String,
  pub user_id: Option<i64>,
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  /// A `VoiceDefinition` must accept a `bezier` ramper (with camelCase `controlPoints`) and
  /// round-trip frontend-only fields that the backend doesn't model explicitly (`filterBypassed`,
  /// `filterEnvelopeEnabled`, the filter's `bypass`, the envelope's `lengthMode`, ...) without
  /// dropping them.
  #[test]
  fn voice_definition_roundtrip_preserves_unmodeled_fields() {
    let input = json!({
      "fmSynthConfig": {},
      "filter": { "type": "lowpass", "frequency": 1000.0, "Q": 1.0, "bypass": false },
      "masterGain": 0.5,
      "filterEnvelope": {
        "steps": [
          { "x": 0.0, "y": 0.0, "ramper": { "type": "linear" } },
          { "x": 1.0, "y": 1.0, "ramper": { "type": "bezier",
            "controlPoints": [{ "x": 0.5, "y": 0.5 }, { "x": 0.6, "y": 0.6 }] } }
        ],
        "lenSamples": 1000.0,
        "loopPoint": null,
        "releasePoint": 0.5,
        "audioThreadData": { "phaseIndex": 0 },
        "lengthMode": 1,
        "logScale": true
      },
      "filterADSRLength": 1000.0,
      "filterBypassed": false,
      "filterEnvelopeEnabled": true
    });

    let parsed: VoiceDefinition = serde_path_to_error::deserialize(&input)
      .unwrap_or_else(|err| panic!("parse failed at `{}`: {}", err.path(), err.inner()));
    let out = serde_json::to_value(&parsed).unwrap();

    assert_eq!(out["filterEnvelope"]["steps"][1]["ramper"]["controlPoints"].as_array().unwrap().len(), 2);
    assert_eq!(out["filterBypassed"], json!(false));
    assert_eq!(out["filterEnvelopeEnabled"], json!(true));
    assert_eq!(out["filter"]["bypass"], json!(false));
    assert_eq!(out["filterEnvelope"]["lengthMode"], json!(1));
  }
}
