use crate::schema::effects;

/// An effect is a component in the audio graph that transforms input signals into output signals.
/// Its functionality is described by Faust code.

#[derive(Serialize, Queryable)]
pub struct Effect {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub code: String,
    pub user_id: Option<i64>,
}

#[derive(Deserialize, Insertable)]
#[table_name = "effects"]
pub struct InsertableEffect {
    pub title: String,
    pub description: String,
    pub code: String,
    #[serde(default)]
    pub user_id: Option<i64>,
}
