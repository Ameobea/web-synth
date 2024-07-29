use chrono::NaiveDateTime;

use crate::schema::{wavetable_presets, wavetable_presets_tags};

#[derive(Queryable, Serialize, Deserialize)]
pub struct WavetablePreset {
  pub id: i64,
  pub name: String,
  pub description: String,
  pub serialized_wavetable_inst_state: String,
  pub user_id: Option<i64>,
  pub created_at: Option<NaiveDateTime>,
}

#[derive(Serialize, Deserialize)]
pub enum BuildWavetableSliderMode {
  Magnitude,
  Phase,
}

#[derive(Serialize, Deserialize)]
pub struct SerializedWavetableHarmonic {
  pub magnitude: f32,
  pub phase: f32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedWavetableInstanceState {
  pub harmonics: Vec<SerializedWavetableHarmonic>,
  pub slider_mode: BuildWavetableSliderMode,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WavetableWaveform {
  pub inst_state: SerializedWavetableInstanceState,
  pub rendered_waveform_samples_base64: String,
}

#[derive(Serialize, Deserialize)]
pub struct SerializedWavetableInstState {
  pub waveforms: Vec<WavetableWaveform>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WavetablePresetDescriptor {
  pub id: i64,
  pub name: String,
  pub description: String,
  pub tags: Vec<String>,
  pub user_id: Option<i64>,
  pub user_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWavetablePresetRequest {
  pub name: String,
  pub description: String,
  pub tags: Vec<String>,
  pub serialized_wavetable_inst_state: SerializedWavetableInstState,
}

#[derive(Insertable)]
#[diesel(table_name = wavetable_presets)]
pub struct NewWavetablePreset {
  pub name: String,
  pub description: String,
  pub serialized_wavetable_inst_state: String,
  pub user_id: Option<i64>,
}

#[derive(Insertable)]
#[diesel(table_name = wavetable_presets_tags)]
pub struct NewWavetablePresetTag {
  pub wavetable_preset_id: i64,
  pub tag_id: i64,
}
