use serde_json::{Map, Value};

use crate::schema::{compositions, compositions_tags};

#[derive(Deserialize)]
pub struct NewCompositionRequest {
    pub title: String,
    pub description: String,
    pub content: Map<String, Value>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Serialize, Insertable)]
#[table_name = "compositions"]
pub struct NewComposition {
    pub author: i64,
    pub title: String,
    pub description: String,
    pub content: String,
}

#[derive(Serialize, Queryable)]
pub struct CompositionDescriptor {
    pub id: i64,
    pub author: i64,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
}

#[derive(Serialize, Queryable)]
pub struct Composition {
    pub id: i64,
    pub author: i64,
    pub title: String,
    pub description: String,
    pub content: String,
}

#[derive(Insertable)]
#[table_name = "compositions_tags"]
pub struct NewCompositionTag {
    pub composition_id: i64,
    pub tag_id: i64,
}
