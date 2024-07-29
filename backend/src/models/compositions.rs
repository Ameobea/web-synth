use serde_json::{Map, Value};

use crate::schema::{compositions, compositions_tags};

#[derive(Deserialize)]
pub struct NewCompositionRequest {
  pub title: String,
  pub description: String,
  pub content: Map<String, Value>,
  #[serde(default)]
  pub tags: Vec<String>,
  #[serde(default)]
  #[serde(rename = "parentID")]
  pub parent_id: Option<i64>,
}

#[derive(Insertable)]
#[diesel(table_name = compositions)]
pub struct NewComposition {
  pub title: String,
  pub description: String,
  pub content: String,
  pub user_id: Option<i64>,
  pub composition_version: i32,
  pub parent_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionVersion {
  pub id: i64,
  pub title: String,
  pub description: String,
  pub composition_version: i32,
  pub created_at: Option<chrono::NaiveDateTime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionDescriptor {
  pub id: i64,
  pub title: String,
  pub description: String,
  pub tags: Vec<String>,
  pub user_id: Option<i64>,
  pub user_name: Option<String>,
  pub versions: Vec<CompositionVersion>,
  pub created_at: Option<chrono::NaiveDateTime>,
}

#[derive(Serialize, Queryable)]
#[serde(rename_all = "camelCase")]
pub struct Composition {
  pub id: i64,
  pub title: String,
  pub description: String,
  pub content: String,
  pub user_id: Option<i64>,
  pub composition_version: i32,
  pub parent_id: Option<i64>,
  pub created_at: Option<chrono::NaiveDateTime>,
}

#[derive(Insertable)]
#[diesel(table_name = compositions_tags)]
pub struct NewCompositionTag {
  pub composition_id: i64,
  pub tag_id: i64,
}
