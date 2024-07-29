use uuid::Uuid;

use crate::schema::{subgraph_preset_tags, subgraph_presets};

#[derive(Insertable)]
#[diesel(table_name = subgraph_presets)]
pub struct NewSubgraphPreset {
  pub user_id: Option<i64>,
  pub title: String,
  pub description: String,
  pub content: String,
}

#[derive(Insertable)]
#[diesel(table_name = subgraph_preset_tags)]
pub struct NewSubgraphPresetTag {
  pub subgraph_preset_id: i64,
  pub tag_id: i64,
}

#[derive(Serialize, Deserialize)]
pub struct SerializedSubgraphPreset {
  pub fcs: Vec<serde_json::Map<String, serde_json::Value>>,
  pub vcs: Vec<serde_json::Map<String, serde_json::Value>>,
  pub intra_conns: Vec<(
    serde_json::Map<String, serde_json::Value>,
    serde_json::Map<String, serde_json::Value>,
  )>,
  pub subgraphs: Vec<(Uuid, serde_json::Map<String, serde_json::Value>)>,
  pub base_subgraph_id: Uuid,
  pub connnecting_subgraph_id: Option<Uuid>,
}
