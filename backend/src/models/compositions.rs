use serde_json::{Map, Value};

use crate::schema::compositions;

#[derive(Deserialize)]
pub struct NewCompositionRequest {
    pub title: String,
    pub description: String,
    pub content: Map<String, Value>,
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
pub struct Composition {
    pub id: i64,
    pub author: i64,
    pub title: String,
    pub description: String,
    pub content: String,
}
