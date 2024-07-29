use chrono::NaiveDateTime;

use crate::schema::{midi_compositions, midi_compositions_tags};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MIDINote {
  pub start_point: f64,
  pub length: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MIDIEditorLine {
  pub midi_number: u16,
  pub notes: Vec<MIDINote>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MIDIEditorView {
  pub px_per_beat: f64,
  pub scroll_horizontal_beats: f64,
  pub scroll_vertical_px: f64,
  pub beats_per_measure: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedMIDIEditorState {
  pub lines: Vec<MIDIEditorLine>,
  pub view: MIDIEditorView,
  pub beat_snap_interval: f64,
  pub cursor_pos_beats: f64,
  #[serde(rename = "localBPM")]
  pub local_bpm: f64,
  pub loop_point: Option<f64>,
}

#[derive(Insertable)]
#[diesel(table_name = midi_compositions)]
pub struct InsertableMIDIComposition {
  pub name: String,
  pub description: String,
  pub composition_json: String,
}

#[derive(Serialize, Queryable)]
#[serde(rename_all = "camelCase")]
pub struct QueryableMIDIComposition {
  pub id: i64,
  pub name: String,
  pub description: String,
  pub composition_json: String,
  pub user_id: Option<i64>,
  pub created_at: Option<NaiveDateTime>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMIDIComposition {
  pub name: String,
  pub description: String,
  pub composition: SerializedMIDIEditorState,
  pub tags: Vec<String>,
  pub user_id: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MIDIComposition {
  pub id: i64,
  pub name: String,
  pub description: String,
  pub composition: SerializedMIDIEditorState,
  pub tags: Vec<String>,
  pub user_id: Option<i64>,
  pub created_at: Option<NaiveDateTime>,
}

#[derive(Insertable)]
#[diesel(table_name = midi_compositions_tags)]
pub struct NewMidiCompositionTag {
  pub midi_composition_id: i64,
  pub tag_id: i64,
}
