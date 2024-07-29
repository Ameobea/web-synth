use crate::schema::effects;

/// An effect is a component in the audio graph that transforms input signals into output signals.
/// Its functionality is described by Faust code.

#[derive(Serialize, Queryable)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
  pub id: i64,
  pub title: String,
  pub description: String,
  pub code: String,
  pub user_id: Option<i64>,
  pub user_name: Option<String>,
}

#[derive(Deserialize, Insertable)]
#[diesel(table_name = effects)]
pub struct InsertableEffect {
  pub title: String,
  pub description: String,
  pub code: String,
  #[serde(default)]
  pub user_id: Option<i64>,
}
