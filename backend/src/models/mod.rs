pub mod compositions;
pub mod effects;
pub mod looper_preset;
pub mod midi_composition;
pub mod private_sample_libraries;
pub mod remote_samples;
pub mod subgraph_presets;
pub mod synth_preset;
pub mod tags;
pub mod user;
pub mod wavetable_preset;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGenericPresetRequest<T> {
  pub name: String,
  pub description: String,
  pub tags: Vec<String>,
  pub preset: T,
}

#[derive(Serialize, Queryable)]
#[serde(rename_all = "camelCase")]
pub struct GenericPresetDescriptor {
  pub id: i64,
  pub name: String,
  pub description: String,
  pub tags: Vec<String>,
  pub user_id: Option<i64>,
  pub user_name: Option<String>,
}
