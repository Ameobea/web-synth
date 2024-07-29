use diesel::Insertable;
use serde::{Deserialize, Serialize};

use crate::{
  models::midi_composition::MIDIComposition,
  schema::{looper_presets, looper_presets_tags},
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperBank {
  pub id: String,
  pub loaded_composition: Option<MIDIComposition>,
  pub len_beats: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooperModule {
  pub name: String,
  pub active_bank_ix: Option<usize>,
  pub banks: Vec<LooperBank>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedLooperInstState {
  pub modules: Vec<LooperModule>,
  pub active_module_ix: usize,
}

#[derive(Insertable)]
#[diesel(table_name = looper_presets)]
pub struct NewLooperPreset {
  pub name: String,
  pub description: String,
  pub serialized_looper_inst_state: String,
  pub user_id: Option<i64>,
}

#[derive(Insertable)]
#[diesel(table_name = looper_presets_tags)]
pub struct NewLooperPresetTag {
  pub looper_preset_id: i64,
  pub tag_id: i64,
}
